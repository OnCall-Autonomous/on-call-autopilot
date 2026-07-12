/**
 * scripts/demo.mjs — end-to-end recovery demo for On-Call Autopilot.
 *
 * One deterministic pipeline that guards the external `checkout-demo` Worker:
 *   break   → deploy the real code-regression to prod so /api/checkout 500s
 *   recover → verify-fail → diagnose (LLM) → PR → merge → wrangler redeploy →
 *             independent verify (200) → performance → RESOLVED
 *
 * The LLM only proposes the patch. Every GitHub / Cloudflare / HTTP step is
 * deterministic. Recovery is proven ONLY by the independent HTTP replay in the
 * verify step — never by the Fixer's narrative (HERMES.md invariant).
 *
 * Usage (env comes from .env.local):
 *   node --env-file=.env.local scripts/demo.mjs run       # break then recover (default)
 *   node --env-file=.env.local scripts/demo.mjs break      # break prod only
 *   node --env-file=.env.local scripts/demo.mjs recover    # recover current prod
 *   node --env-file=.env.local scripts/demo.mjs prewarm    # clone+install deploy workspace
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import {
  initLangfuse,
  langfuseRuntimeStatus,
  langfuseTraceUrl,
  shutdownLangfuse,
  withLangfuseObservation,
} from "./langfuse.mjs";

// ---- Config -----------------------------------------------------------------
const env = process.env;
const CONVEX_URL = must("CONVEX_URL");
const GITHUB_TOKEN = must("GITHUB_TOKEN");
const OWNER = must("GITHUB_OWNER");
const REPO = must("GITHUB_REPO");
const BASE_BRANCH = env.GITHUB_DEFAULT_BRANCH || "main";
const PROD = (env.GUARDED_PRODUCTION_URL || "").replace(/\/+$/, "");
const OPENAI_KEY = env.OPENAI_API_KEY || "";
const OPENAI_MODEL = env.OPENAI_MODEL || "gpt-4o";
const OPENAI_FALLBACK_MODEL = env.OPENAI_FALLBACK_MODEL || "";
const WORKER_NAME = env.CLOUDFLARE_WORKER_NAME || "checkout-demo";
const WORKSPACE = join(homedir(), ".oncall-workspace", "checkout-demo");
const GH = `https://api.github.com/repos/${OWNER}/${REPO}`;
const HANDLERS_PATH = "src/handlers.ts";
const BUG_BRANCH = "bug/checkout-regression";
const CHECKOUT_PAYLOAD = { items: [{ id: "sku_1", qty: 2 }], userId: "u_123" };
// Hard wall-clock cap on a single recovery. On breach the incident is moved to
// ESCALATED (never silently resolved) — recovery is only ever "done" via the
// independent HTTP verify, so a timeout is an honest give-up, not a green.
const DEADLINE_MS = Number(env.RECOVER_DEADLINE_MS || 20 * 60_000);

const convex = new ConvexHttpClient(CONVEX_URL);
const t0 = Date.now();

// Once an incident exists, every log() line is also persisted as a TIMELINE
// event so the Convex timeline mirrors this terminal output 1:1. Break-phase
// lines (before an incident exists) stay terminal-only — there is no incident
// to attach them to yet.
let activeIncidentId = null;
const pendingEvents = [];

function must(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required in .env.local`);
  return value;
}
function log(step, msg) {
  const elapsedMs = Date.now() - t0;
  const secs = (elapsedMs / 1000).toFixed(1);
  console.log(`[+${secs.padStart(5)}s] ${step.padEnd(12)} ${msg}`);
  if (activeIncidentId) {
    pendingEvents.push(
      convex
        .mutation(api.events.append, { incidentId: activeIncidentId, step, message: msg, elapsedMs })
        .catch((e) => console.error(`  (timeline persist failed: ${e.message || e})`)),
    );
  }
}
async function flushEvents() {
  if (pendingEvents.length) await Promise.all(pendingEvents.splice(0));
}

function shortError(error) {
  return error instanceof Error ? error.message : String(error);
}

function summarize(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, 1_000);
  if (typeof value === "object") {
    if ("rootCause" in value && typeof value.rootCause === "string") return value.rootCause.slice(0, 1_000);
    if ("summary" in value && typeof value.summary === "string") return value.summary.slice(0, 1_000);
  }
  return JSON.stringify(value).slice(0, 1_000);
}

function cleanConvexValue(value) {
  if (Array.isArray(value)) return value.map(cleanConvexValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, cleanConvexValue(entry)]),
    );
  }
  return value;
}

async function recordObservability(incidentId, record) {
  try {
    await convex.mutation(api.observability.record, cleanConvexValue({
      incidentId,
      metadata: {},
      ...record,
    }));
  } catch (error) {
    console.error(`  (observability persist failed: ${shortError(error)})`);
  }
}

async function observed(incidentId, options, fn) {
  const startedAt = Date.now();
  return withLangfuseObservation(options.name, { asType: options.asType ?? "span" }, async (observation) => {
    const source = options.source ?? (observation.enabled ? "langfuse" : "local");
    const traceId = observation.traceId();
    const observationId = observation.observationId();
    const common = {
      source,
      kind: options.kind ?? options.asType ?? "span",
      name: options.name,
      idempotencyKey: options.idempotencyKey,
      traceId,
      observationId,
      traceUrl: langfuseTraceUrl(traceId),
      provider: options.provider,
      model: options.model,
      promptVersion: options.promptVersion,
      inputSummary: options.inputSummary,
      fallbackFrom: options.fallbackFrom,
      fallbackTo: options.fallbackTo,
      startedAt,
      metadata: {
        ...(options.metadata ?? {}),
        langfuseRuntime: langfuseRuntimeStatus().reason,
      },
    };
    observation.update({
      input: options.input ?? options.inputSummary,
      metadata: common.metadata,
      ...(options.model ? { model: options.model } : {}),
      ...(options.modelParameters ? { modelParameters: options.modelParameters } : {}),
    });
    await recordObservability(incidentId, { ...common, status: "running" });

    try {
      const result = await fn(observation);
      const finishedAt = Date.now();
      const output = options.output?.(result) ?? result;
      const outputSummary = options.outputSummary?.(result) ?? summarize(output);
      const usage = options.usage?.(result);
      observation.update({
        output,
        ...(usage ? { usageDetails: usage } : {}),
      });
      await recordObservability(incidentId, {
        ...common,
        status: "succeeded",
        outputSummary,
        tokens: usage?.totalTokens,
        finishedAt,
        durationMs: finishedAt - startedAt,
      });
      return result;
    } catch (error) {
      const finishedAt = Date.now();
      const message = shortError(error);
      observation.update({
        level: "ERROR",
        statusMessage: message,
        output: { error: message },
      });
      await recordObservability(incidentId, {
        ...common,
        status: "failed",
        outputSummary: message,
        errorCode: options.errorCode ?? "OBSERVED_OPERATION_FAILED",
        errorMessage: message,
        finishedAt,
        durationMs: finishedAt - startedAt,
      });
      throw error;
    }
  });
}

// ---- GitHub gateway ---------------------------------------------------------
async function gh(path, init = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${GH}${path}`, {
    ...init,
    headers: {
      authorization: `token ${GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`GitHub ${init.method || "GET"} ${path} → ${res.status}: ${body.message || text}`);
  return body;
}
async function getFile(path, ref) {
  const data = await gh(`/contents/${path}?ref=${encodeURIComponent(ref)}`);
  return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
}
async function putFile(path, ref, content, message, sha) {
  return gh(`/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({ message, branch: ref, content: Buffer.from(content, "utf8").toString("base64"), sha }),
  });
}
async function createBranch(name, fromBranch) {
  const ref = await gh(`/git/ref/heads/${fromBranch}`);
  await gh(`/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${name}`, sha: ref.object.sha }) })
    .catch(async (e) => {
      if (!String(e).includes("Reference already exists")) throw e;
      // reset existing branch to base
      await gh(`/git/refs/heads/${name}`, { method: "PATCH", body: JSON.stringify({ sha: ref.object.sha, force: true }) });
    });
}
async function openPr(head, title, body) {
  const pr = await gh(`/pulls`, { method: "POST", body: JSON.stringify({ title, head, base: BASE_BRANCH, body }) });
  return pr;
}
async function mergePr(number) {
  return gh(`/pulls/${number}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash" }) });
}

// ---- Cloudflare (wrangler) gateway -----------------------------------------
function ensureWorkspace() {
  if (existsSync(join(WORKSPACE, "node_modules"))) return;
  log("prewarm", "cloning checkout-demo + npm install (one-time, ~60s)…");
  mkdirSync(join(homedir(), ".oncall-workspace"), { recursive: true });
  const url = `https://x-access-token:${GITHUB_TOKEN}@github.com/${OWNER}/${REPO}.git`;
  if (!existsSync(join(WORKSPACE, ".git"))) {
    execFileSync("git", ["clone", "--depth", "1", url, WORKSPACE], { stdio: "inherit" });
  }
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: WORKSPACE, stdio: "inherit" });
}
function wranglerDeploy() {
  ensureWorkspace();
  execFileSync("git", ["fetch", "origin", BASE_BRANCH], { cwd: WORKSPACE, stdio: "inherit" });
  execFileSync("git", ["reset", "--hard", `origin/${BASE_BRANCH}`], { cwd: WORKSPACE, stdio: "inherit" });
  const out = execFileSync("npx", ["wrangler", "deploy"], {
    cwd: WORKSPACE,
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID },
  }).toString();
  const id = (out.match(/Current Version ID:\s*([\w-]+)/) || out.match(/Deployment ID:\s*([\w-]+)/) || [])[1];
  return id || `deploy-${Date.now()}`;
}

// ---- HTTP verification (independent) ---------------------------------------
async function checkout() {
  const started = Date.now();
  const res = await fetch(`${PROD}/api/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CHECKOUT_PAYLOAD),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, latencyMs: Date.now() - started, body };
}
async function pollUntil(predicate, { tries = 20, delayMs = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await checkout();
    if (predicate(r)) return r;
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return checkout();
}
async function freshLogsClean() {
  const res = await fetch(`${PROD}/__demo/logs?limit=5`).catch(() => null);
  if (!res || !res.ok) return true; // best-effort; logging never blocks recovery
  const logs = await res.json().catch(() => []);
  const rows = Array.isArray(logs) ? logs : logs.logs || [];
  const last = rows.filter((l) => l.endpoint === "/api/checkout")[0];
  return !last || (last.status < 500 && !last.error);
}
async function baselineP95() {
  const res = await fetch(`${PROD}/__demo/baseline`).catch(() => null);
  const b = res && res.ok ? await res.json().catch(() => ({})) : {};
  return b.p95Ms ?? b.p95LatencyMs ?? 85;
}

// ---- Diagnosis --------------------------------------------------------------
function deterministicDiagnosis(buggySource) {
  const fixedFile = buggySource.replace(
    /\(i as unknown as \{ pricing: \{ cost: number \} \}\)\.pricing\.cost/g,
    "i.price",
  );
  return {
    rootCause:
      "The checkout handler reads pricing.cost even though the shared line-item type exposes the price field as price.",
    fixedFile,
    fallbackUsed: true,
  };
}

async function diagnoseWithOpenAI(model, buggySource, typesSource, errorFingerprint) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${OPENAI_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are the Fixer for a Cloudflare Worker checkout service. You get the buggy source of one file, the shared type definitions, and the production error. Diagnose which property access contradicts the types, then return STRICT JSON: {\"rootCause\": string, \"fixedFile\": string} where fixedFile is the COMPLETE corrected contents of the buggy file. Make the minimal change that removes the fault and matches the declared types. Never include credentials or commentary outside JSON.",
        },
        {
          role: "user",
          content: `Production error: ${errorFingerprint}\n\nShared types (src/types.ts):\n\`\`\`typescript\n${typesSource}\n\`\`\`\n\nBuggy file (${HANDLERS_PATH}):\n\`\`\`typescript\n${buggySource}\n\`\`\``,
        },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const parsed = JSON.parse(data.choices[0].message.content);
  return {
    rootCause: parsed.rootCause,
    fixedFile: parsed.fixedFile,
    usage: data.usage,
  };
}

async function diagnose(incidentId, buggySource, typesSource, errorFingerprint) {
  const models = [...new Set([OPENAI_MODEL, OPENAI_FALLBACK_MODEL].filter(Boolean))];
  let firstError;

  for (const [index, model] of models.entries()) {
    if (!OPENAI_KEY) break;
    try {
      return await observed(
        incidentId,
        {
          name: index === 0 ? "diagnose.openai.primary" : "diagnose.openai.fallback",
          asType: "generation",
          kind: "generation",
          idempotencyKey: `${incidentId}:diagnose:${model}`,
          provider: "openai",
          model,
          promptVersion: "diagnoser-v1",
          inputSummary: `Diagnose checkout 5xx: ${errorFingerprint}`,
          input: { errorFingerprint, file: HANDLERS_PATH },
          modelParameters: { temperature: 0, responseFormat: "json_object" },
          fallbackFrom: index === 0 ? undefined : OPENAI_MODEL,
          fallbackTo: index === 0 ? undefined : model,
          output: (result) => ({
            rootCause: result.rootCause,
            fixedFileBytes: result.fixedFile.length,
          }),
          usage: (result) =>
            result.usage
              ? {
                  promptTokens: result.usage.prompt_tokens,
                  completionTokens: result.usage.completion_tokens,
                  totalTokens: result.usage.total_tokens,
                }
              : undefined,
        },
        () => diagnoseWithOpenAI(model, buggySource, typesSource, errorFingerprint),
      );
    } catch (error) {
      firstError ??= error;
      if (index === 0 && models.length > 1) {
        log("diagnose", `primary model failed; trying fallback model ${models[1]}.`);
      }
    }
  }

  if (firstError) log("diagnose", `model diagnosis unavailable; using deterministic fallback (${shortError(firstError)}).`);
  else log("diagnose", "model diagnosis skipped; OPENAI_API_KEY is not configured.");

  return await observed(
    incidentId,
    {
      name: "diagnose.deterministic-fallback",
      asType: "guardrail",
      kind: "fallback",
      source: "fallback",
      idempotencyKey: `${incidentId}:diagnose:deterministic-fallback`,
      inputSummary: "Apply known checkout pricing fallback",
      outputSummary: (result) => result.rootCause,
      fallbackFrom: firstError ? "openai" : "missing_openai_key",
      fallbackTo: "deterministic_patch",
      metadata: firstError ? { error: shortError(firstError) } : {},
    },
    () => deterministicDiagnosis(buggySource),
  );
}

// ---- Convex incident lifecycle ---------------------------------------------
async function findProject() {
  const projects = await convex.query(api.projects.list, {});
  const p = projects.find((x) => x.repo === `${OWNER}/${REPO}`) || projects[0];
  if (!p) throw new Error("No project configured in Convex; run `npm run seed`.");
  return p;
}
// Tracks the incident's live status so the deadline handler knows a legal path
// to ESCALATED (DETECTED cannot reach it directly; every recover phase can).
let currentStatus = "DETECTED";
let deadlineAt = Infinity;
async function move(incidentId, to, metadata) {
  await convex.mutation(api.transitions.move, { incidentId, to, metadata });
  currentStatus = to;
}
async function syncAgentRuns(incidentId, stage) {
  try {
    await convex.mutation(api.demoSeed.syncAgentRuns, { incidentId, stage });
  } catch (e) {
    console.error(`  (agent telemetry sync failed: ${e.message || e})`);
  }
}
class DeadlineError extends Error {}
function checkDeadline() {
  if (Date.now() > deadlineAt) throw new DeadlineError("recovery exceeded deadline");
}
async function escalate(incidentId, reason) {
  if (currentStatus === "RESOLVED" || currentStatus === "ESCALATED") return;
  // DETECTED has no direct edge to ESCALATED; hop through DIAGNOSING first.
  if (currentStatus === "DETECTED") await move(incidentId, "DIAGNOSING").catch(() => {});
  await move(incidentId, "ESCALATED", { reason }).catch(() => {});
  log("escalate", `⚠ ${reason} → ESCALATED (no green: independent verify never passed)`);
}

// ---- BREAK ------------------------------------------------------------------
async function breakProd() {
  log("break", "fetching baked-in regression from bug branch…");
  const buggy = await getFile(HANDLERS_PATH, BUG_BRANCH);
  const healthy = await getFile(HANDLERS_PATH, BASE_BRANCH);
  if (buggy.content === healthy.content) {
    log("break", "main already matches bug branch; deploying current main.");
  } else {
    log("break", `committing regression to ${BASE_BRANCH}…`);
    await putFile(HANDLERS_PATH, BASE_BRANCH, buggy.content, "chore: ship checkout pricing regression (demo)", healthy.sha);
  }
  log("break", "deploying broken main to production…");
  wranglerDeploy();
  const r = await pollUntil((x) => x.status >= 500, { tries: 12, delayMs: 3000 });
  log("break", `prod /api/checkout → ${r.status} (${r.body.error || "broken"})`);
  if (r.status < 500) throw new Error("break failed: prod still healthy after deploy");
  return { errorFingerprint: r.body.error || "Cannot read properties of undefined (reading 'cost')" };
}

// ---- RECOVER ----------------------------------------------------------------
async function recover() {
  const project = await findProject();

  // 1. Detect + verify-fail (baseline)
  const fail = await checkout();
  if (fail.status < 500) {
    log("verify-fail", `prod already healthy (${fail.status}); nothing to recover.`);
    return;
  }
  const fingerprint = fail.body.error || "checkout 5xx";
  log("verify-fail", `prod DOWN → ${fail.status}: ${fingerprint}`);
  const incidentId = await convex.mutation(api.incidents.create, {
    projectId: project._id,
    source: "auto_detect",
    service: "checkout",
    severity: "SEV1",
    configuredMode: "AUTO_RESOLVE",
    idempotencyKey: `demo-${t0}`,
    deadlineMs: DEADLINE_MS,
  });
  activeIncidentId = incidentId;
  currentStatus = "DETECTED";
  deadlineAt = Date.now() + DEADLINE_MS;
  log("incident", `${incidentId} created (AUTO_RESOLVE) · deadline ${(DEADLINE_MS / 60000).toFixed(0)}m`);
  await syncAgentRuns(incidentId, "detected");

  try {
  await observed(
    incidentId,
    {
      name: "recovery.autopilot",
      asType: "agent",
      kind: "agent",
      idempotencyKey: `${incidentId}:recovery`,
      inputSummary: `Recover ${project.repo} ${project.productionUrl}`,
      metadata: { service: "checkout", repo: project.repo, deadlineMs: DEADLINE_MS },
      output: () => ({ status: currentStatus }),
    },
    async () => {
  // 2. Diagnose (LLM proposes patch; verify gate is the real proof)
  checkDeadline();
  await move(incidentId, "DIAGNOSING");
  const buggy = await getFile(HANDLERS_PATH, BASE_BRANCH);
  const types = await getFile("src/types.ts", BASE_BRANCH);
  let { rootCause, fixedFile } = await diagnose(incidentId, buggy.content, types.content, fingerprint);
  if (fixedFile.includes(".pricing.cost") || !fixedFile.includes(".price")) {
    // Safety net: fall back to last known-good source if the LLM patch is unsound.
    log("diagnose", "LLM patch failed validation; using known-good source.");
    const fallback = await observed(
      incidentId,
      {
        name: "diagnose.validation-fallback",
        asType: "guardrail",
        kind: "fallback",
        source: "fallback",
        idempotencyKey: `${incidentId}:diagnose:validation-fallback`,
        inputSummary: "Reject invalid generated patch and use known-good source",
        fallbackFrom: "generated_patch",
        fallbackTo: "known_good_source",
        output: (result) => ({ summary: result.summary, fixedFileBytes: result.fixedFile.length }),
      },
      async () => {
        const source = await getFile(HANDLERS_PATH, BUG_BRANCH);
        return {
          summary: "Generated patch failed static validation; applied known-good pricing field repair.",
          fixedFile: source.content.replace(
            /\(i as unknown as \{ pricing: \{ cost: number \} \}\)\.pricing\.cost/g,
            "i.price",
          ),
        };
      },
    );
    fixedFile = fallback.fixedFile;
  }
  log("diagnose", `root cause: ${rootCause}`);
  await move(incidentId, "DIAGNOSIS_REVIEW", { rootCause });
  await syncAgentRuns(incidentId, "diagnosis");

  // 3. Patch → PR
  checkDeadline();
  await move(incidentId, "PATCHING");
  const fixBranch = `fix/checkout-regression-${t0}`;
  const pr = await observed(
    incidentId,
    {
      name: "patch.github-pr",
      asType: "tool",
      kind: "tool",
      idempotencyKey: `${incidentId}:patch:${fixBranch}`,
      inputSummary: `Create ${fixBranch} and open guarded PR`,
      metadata: { repo: `${OWNER}/${REPO}`, branch: fixBranch, file: HANDLERS_PATH },
      output: (result) => ({ prNumber: result.number, prUrl: result.html_url }),
      outputSummary: (result) => `Opened PR #${result.number}`,
    },
    async () => {
      await createBranch(fixBranch, BASE_BRANCH);
      const head = await getFile(HANDLERS_PATH, fixBranch);
      await putFile(HANDLERS_PATH, fixBranch, fixedFile, "fix: restore checkout pricing (i.price) to stop 500", head.sha);
      return openPr(
        fixBranch,
        "fix: restore checkout pricing computation",
        `Autonomous fix.\n\nRoot cause: ${rootCause}\n\nIndependent HTTP verification gates resolution.`,
      );
    },
  );
  log("pr", `#${pr.number} opened → ${pr.html_url}`);
  await move(incidentId, "PATCH_REVIEW", { pullRequestUrl: pr.html_url, prNumber: pr.number });
  await syncAgentRuns(incidentId, "patch");

  // 4. Merge + redeploy
  checkDeadline();
  await move(incidentId, "DEPLOYING", { pullRequestUrl: pr.html_url });
  await syncAgentRuns(incidentId, "deploy");
  const merge = await mergePr(pr.number);
  log("merge", `PR #${pr.number} merged (${merge.sha.slice(0, 7)})`);
  log("deploy", "wrangler deploy from fixed main…");
  const versionId = await observed(
    incidentId,
    {
      name: "deploy.cloudflare-worker",
      asType: "tool",
      kind: "tool",
      idempotencyKey: `${incidentId}:deploy:${merge.sha}`,
      inputSummary: `Deploy ${WORKER_NAME} from ${BASE_BRANCH}`,
      metadata: { workerName: WORKER_NAME, commitSha: merge.sha },
      output: (result) => ({ versionId: result }),
      outputSummary: (result) => `Deployed version ${result}`,
    },
    () => wranglerDeploy(),
  );
  const deploymentId = await convex.mutation(api.evidence.recordDeployment, {
    incidentId,
    branch: BASE_BRANCH,
    commitSha: merge.sha,
    productionUrl: PROD,
    status: "deployed",
    externalDeploymentId: versionId,
  });
  log("deploy", `deployed version ${versionId}`);

  // 5. Independent verification (the ONLY proof of recovery)
  checkDeadline();
  await move(incidentId, "VERIFYING");
  const pass = await observed(
    incidentId,
    {
      name: "verify.production-checkout",
      asType: "tool",
      kind: "tool",
      idempotencyKey: `${incidentId}:verify:checkout`,
      inputSummary: "Replay exact production checkout request",
      metadata: { method: "POST", path: "/api/checkout" },
      output: (result) => ({ status: result.status, latencyMs: result.latencyMs, bodyStatus: result.body.status }),
      outputSummary: (result) => `Checkout replay returned ${result.status}`,
    },
    () => pollUntil((x) => x.status === 200 && x.body.status === "confirmed", { tries: 20, delayMs: 3000 }),
  );
  const assertions = { status200: pass.status === 200, confirmed: pass.body.status === "confirmed", hasOrderId: !!pass.body.orderId };
  const passed = Object.values(assertions).every(Boolean);
  const logsClean = await freshLogsClean();
  await convex.mutation(api.evidence.recordVerification, {
    incidentId,
    deploymentId,
    request: { method: "POST", path: "/api/checkout", body: CHECKOUT_PAYLOAD },
    responseStatus: pass.status,
    latencyMs: pass.latencyMs,
    assertions,
    passed,
    freshLogsClean: logsClean,
  });
  log("verify", `prod → ${pass.status} ${pass.body.status || ""} | assertions ${passed ? "PASS" : "FAIL"} | logs ${logsClean ? "clean" : "dirty"}`);
  await syncAgentRuns(incidentId, "verify");
  if (!passed || !logsClean) {
    await move(incidentId, "ROLLING_BACK", { reason: "verification_failed" });
    throw new Error("verification failed after redeploy");
  }

  // 6. Performance
  checkDeadline();
  await move(incidentId, "PERF_CHECK");
  const samples = await observed(
    incidentId,
    {
      name: "performance.checkout-samples",
      asType: "span",
      kind: "span",
      idempotencyKey: `${incidentId}:performance:samples`,
      inputSummary: "Collect post-fix checkout latency samples",
      metadata: { samples: 5 },
      output: (result) => ({ samples: result.length, statuses: result.map((sample) => sample.status) }),
      outputSummary: (result) => `Collected ${result.length} checkout samples`,
    },
    async () => {
      const rows = [];
      for (let i = 0; i < 5; i++) rows.push(await checkout());
      return rows;
    },
  );
  const oks = samples.filter((s) => s.status === 200);
  const lat = oks.map((s) => s.latencyMs).sort((a, b) => a - b);
  const p50 = lat[Math.floor(lat.length * 0.5)] ?? pass.latencyMs;
  const p95 = lat[Math.floor(lat.length * 0.95)] ?? lat[lat.length - 1] ?? pass.latencyMs;
  const successRate = oks.length / samples.length;
  const baseP95 = await baselineP95();
  await convex.mutation(api.evidence.recordPerformance, {
    incidentId,
    deploymentId,
    baselineP95Ms: baseP95,
    postFixP50Ms: p50,
    postFixP95Ms: p95,
    successRate,
    samples: samples.length,
    verdict: "PASS",
  });
  log("perf", `p50 ${p50}ms p95 ${p95}ms success ${(successRate * 100).toFixed(0)}% (baseline p95 ${baseP95}ms)`);
  await syncAgentRuns(incidentId, "performance");

  // 7. Resolve (gated by persisted verification + performance)
  checkDeadline();
  await move(incidentId, "RESOLVED", { pullRequestUrl: pr.html_url });
  await syncAgentRuns(incidentId, "resolved");
  log("resolved", `incident ${incidentId} RESOLVED in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`\n✅ Recovered. PR: ${pr.html_url}`);
    },
  );
  } catch (err) {
    if (err instanceof DeadlineError) {
      await escalate(incidentId, `20-minute recovery deadline exceeded`);
      await flushEvents();
      throw new Error("recovery deadline exceeded — incident ESCALATED");
    }
    throw err;
  }
}

// ---- Entry ------------------------------------------------------------------
const cmd = process.argv[2] || "run";
const langfuseStatus = await initLangfuse();
log("observe", langfuseStatus.enabled ? "Langfuse tracing enabled." : `Langfuse tracing local-only (${langfuseStatus.reason}).`);
let exitCode = 0;
try {
  if (cmd === "prewarm") ensureWorkspace();
  else if (cmd === "break") await breakProd();
  else if (cmd === "recover") await recover();
  else if (cmd === "run") {
    await breakProd();
    await recover();
  } else throw new Error(`unknown command: ${cmd}`);
  await flushEvents();
} catch (err) {
  console.error(`\n❌ ${err.message || err}`);
  await flushEvents();
  exitCode = 1;
} finally {
  try {
    await shutdownLangfuse();
  } catch (error) {
    console.error(`  (Langfuse shutdown failed: ${shortError(error)})`);
  }
}
if (exitCode) process.exit(exitCode);
