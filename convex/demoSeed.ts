import { mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// DEMO SEED (not a production path). Inserts fully-formed, already-RESOLVED
// incidents so the dashboard/timeline has realistic history. Each incident
// mirrors one autonomous PR fix and walks the real AUTO_RESOLVE state path,
// emitting the same STATE_TRANSITION + TIMELINE events the live demo would,
// plus deployment / verification / performance evidence. The RESOLVED
// invariant (passing independent verification + PASS performance) is honored:
// evidence rows are inserted before the incident is marked RESOLVED.
// Idempotent per scenario via idempotencyKey.

type Scenario = {
  key: string;
  service: string;
  severity: "SEV1" | "SEV2" | "SEV3";
  daysAgo: number;
  durationSec: number;
  prNumber: number;
  fixBranch: string;
  commitSha: string;
  versionId: string;
  errorFingerprint: string;
  rootCause: string;
  confidence: number;
  resolutionSummary: string;
  baselineP95Ms: number;
  postFixP50Ms: number;
  postFixP95Ms: number;
};

type DemoLogRow = {
  timestamp: number;
  endpoint: string;
  method: string;
  status: number;
  latency: number;
  error?: string;
  requestId: string;
  version: string;
  projectId: Id<"projects">;
};

type DemoStage = "detected" | "diagnosis" | "patch" | "deploy" | "verify" | "performance" | "resolved";
type DemoAgentName = "COMMANDER" | "DIAGNOSER" | "FIXER" | "VERIFIER" | "PERFORMANCE" | "REPORTER" | "TEMP_SPECIALIST";
type DemoRunStatus = "queued" | "running" | "succeeded";
type DemoAgentPlan = {
  agent: DemoAgentName;
  startStage: DemoStage;
  completeStage: DemoStage;
  inputSummary: string;
  outputSummary: string;
  promptVersion: string;
  provider?: string;
  model?: string;
  tokens: number;
  cost: number;
  durationMs: number;
  offsetMs: number;
};

const OWNER = "OnCall-Autonomous";
const REPO = "checkout-demo";
const PROD = "https://checkout-demo.ashishsoni2002.workers.dev";
const CHECKOUT_PAYLOAD = { items: [{ id: "sku_1", qty: 2 }], userId: "u_123" };

const STAGE_INDEX: Record<DemoStage, number> = {
  detected: 0,
  diagnosis: 1,
  patch: 2,
  deploy: 3,
  verify: 4,
  performance: 5,
  resolved: 6,
};

const RUN_STATUS_RANK: Record<DemoRunStatus, number> = { queued: 0, running: 1, succeeded: 2 };

const DEMO_AGENT_PLANS: DemoAgentPlan[] = [
  {
    agent: "COMMANDER",
    startStage: "detected",
    completeStage: "diagnosis",
    inputSummary: "Coordinate autonomous checkout recovery",
    outputSummary: "Validated incident scope and scheduled the recovery crew.",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
    promptVersion: "commander-v1",
    tokens: 1120,
    cost: 0.013,
    durationMs: 2400,
    offsetMs: 900,
  },
  {
    agent: "DIAGNOSER",
    startStage: "detected",
    completeStage: "diagnosis",
    inputSummary: "Correlate checkout 5xx logs, recent deploys, and code diff",
    outputSummary: "Found checkout reads pricing.cost although the item type exposes price.",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
    promptVersion: "diagnoser-v1",
    tokens: 2840,
    cost: 0.034,
    durationMs: 11800,
    offsetMs: 3200,
  },
  {
    agent: "TEMP_SPECIALIST",
    startStage: "diagnosis",
    completeStage: "diagnosis",
    inputSummary: "Decide whether a specialist is needed for the checkout regression",
    outputSummary: "No specialist needed; root cause confidence is above threshold.",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
    promptVersion: "specialist-v1",
    tokens: 460,
    cost: 0.006,
    durationMs: 1300,
    offsetMs: 8900,
  },
  {
    agent: "FIXER",
    startStage: "diagnosis",
    completeStage: "patch",
    inputSummary: "Prepare the minimal checkout pricing patch",
    outputSummary: "Generated a one-file fix and opened a guarded PR.",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
    promptVersion: "fixer-v1",
    tokens: 3920,
    cost: 0.047,
    durationMs: 15400,
    offsetMs: 12_800,
  },
  {
    agent: "VERIFIER",
    startStage: "deploy",
    completeStage: "verify",
    inputSummary: "Replay the exact production checkout request",
    outputSummary: "Independent HTTP replay returned 200 confirmed with order id.",
    promptVersion: "verifier-v1",
    tokens: 0,
    cost: 0,
    durationMs: 3900,
    offsetMs: 35_500,
  },
  {
    agent: "PERFORMANCE",
    startStage: "verify",
    completeStage: "performance",
    inputSummary: "Measure post-fix checkout latency and success rate",
    outputSummary: "Post-fix samples passed latency and success-rate gates.",
    promptVersion: "performance-v1",
    tokens: 0,
    cost: 0,
    durationMs: 2600,
    offsetMs: 41_200,
  },
  {
    agent: "REPORTER",
    startStage: "performance",
    completeStage: "resolved",
    inputSummary: "Summarize the recovery and evidence trail",
    outputSummary: "Wrote the final incident summary with PR, deploy, verification, and performance proof.",
    provider: "openrouter",
    model: "openai/gpt-4.1-mini",
    promptVersion: "reporter-v1",
    tokens: 980,
    cost: 0.004,
    durationMs: 2100,
    offsetMs: 45_500,
  },
];

const SCENARIOS: Scenario[] = [
  {
    key: "checkout-pricing-regression",
    service: "checkout",
    severity: "SEV1",
    daysAgo: 9,
    durationSec: 74,
    prNumber: 142,
    fixBranch: "fix/checkout-pricing-regression",
    commitSha: "4b9c2e1a7f6d3c8b5a4e9d2f1c0b8a7e6d5c4b3a",
    versionId: "b1e7a4c2-9f3d-4a1e-8c6b-2d5f7a9c1e04",
    errorFingerprint: "Cannot read properties of undefined (reading 'cost')",
    rootCause:
      "Line-item total read `i.pricing.cost`, but the shared LineItem type exposes the unit price as `i.price`; `pricing` is undefined at runtime so `/api/checkout` threw a TypeError and returned 500.",
    confidence: 0.94,
    resolutionSummary:
      "Restored the line-item total to use `i.price` per the shared types; independent HTTP replay returned 200 confirmed.",
    baselineP95Ms: 88,
    postFixP50Ms: 61,
    postFixP95Ms: 92,
  },
  {
    key: "checkout-empty-cart-npe",
    service: "checkout",
    severity: "SEV2",
    daysAgo: 6,
    durationSec: 58,
    prNumber: 147,
    fixBranch: "fix/empty-cart-guard",
    commitSha: "a7f3d9c1b2e8460f5c3a1d7e9b4f2c8a6d0e5b1f",
    versionId: "c4d8f1a6-3b2e-4d7c-9a1f-6e0b5c3d8f27",
    errorFingerprint: "Reduce of empty array with no initial value",
    rootCause:
      "`items.reduce((a,b)=>a+b.price*b.qty)` was called without an initial accumulator; an empty `items[]` payload made reduce throw, returning 500 instead of a 400 validation error.",
    confidence: 0.9,
    resolutionSummary:
      "Added a zero initial value to the total reducer and an empty-cart 400 guard; replay with an empty cart now returns a clean 400 and valid carts return 200.",
    baselineP95Ms: 84,
    postFixP50Ms: 57,
    postFixP95Ms: 89,
  },
  {
    key: "checkout-inventory-timeout",
    service: "checkout",
    severity: "SEV1",
    daysAgo: 4,
    durationSec: 121,
    prNumber: 151,
    fixBranch: "fix/inventory-await",
    commitSha: "9d2b6f4a1c8e7305b9f1a3d6c2e4b8f0a5d7c1e9",
    versionId: "e2a9c5d3-7f4b-4e1a-b8c6-3d0f5a2c9e18",
    errorFingerprint: "checkout 5xx: stock check returned Promise<pending>",
    rootCause:
      "The stock-availability call `checkStock(...)` was not awaited, so the handler compared a pending Promise against the requested qty; every request fell through to the out-of-stock 5xx branch.",
    confidence: 0.88,
    resolutionSummary:
      "Awaited `checkStock` and short-circuited on insufficient inventory; independent replay confirms 200 with a reserved order id.",
    baselineP95Ms: 96,
    postFixP50Ms: 68,
    postFixP95Ms: 104,
  },
  {
    key: "checkout-tax-rounding",
    service: "checkout",
    severity: "SEV3",
    daysAgo: 2,
    durationSec: 63,
    prNumber: 154,
    fixBranch: "fix/tax-rounding",
    commitSha: "1c5e8a2f7b3d9046a1e7c4b2d8f6a0c3e9b5d2f7",
    versionId: "f7b3d1a8-2c6e-4f9d-a5b1-7c0e3d8f6a24",
    errorFingerprint: "422 Unprocessable: computed tax does not match line totals",
    rootCause:
      "Tax was computed with floating-point cents (`total * 0.0825`) and compared to a rounded expected value; sub-cent drift tripped the 422 integrity assertion on some carts.",
    confidence: 0.86,
    resolutionSummary:
      "Computed tax in integer cents with round-half-up before assembling the response; replay across sample carts returns 200 with a matching tax line.",
    baselineP95Ms: 82,
    postFixP50Ms: 55,
    postFixP95Ms: 87,
  },
  {
    key: "checkout-idempotency-double-charge",
    service: "checkout",
    severity: "SEV2",
    daysAgo: 1,
    durationSec: 97,
    prNumber: 158,
    fixBranch: "fix/idempotency-key",
    commitSha: "6a0d4c9e2f1b8375c0a6e3d1f9b4c7a2e8d5b0f3",
    versionId: "a5c2e9f4-1d7b-4a3c-8e6f-0b9d2c5a7e13",
    errorFingerprint: "duplicate order created on client retry (idempotency key ignored)",
    rootCause:
      "The `Idempotency-Key` header was parsed but never used to look up an existing order, so a client retry after a slow response created a second order and a duplicate charge.",
    confidence: 0.91,
    resolutionSummary:
      "Keyed order creation on the idempotency key and returned the original order on replay; a retried request now yields the same order id and no second charge.",
    baselineP95Ms: 90,
    postFixP50Ms: 63,
    postFixP95Ms: 95,
  },
];

function scenarioLogs(projectId: Id<"projects">, s: Scenario, startedAt: number): DemoLogRow[] {
  const bugVersion = `bug-${s.key}`;
  const fixedVersion = s.versionId;
  const id = (name: string) => `demo-${s.key}-${name}`;
  const row = (
    offsetMs: number,
    requestId: string,
    method: string,
    endpoint: string,
    status: number,
    latency: number,
    version: string,
    error?: string,
  ): DemoLogRow => ({
    timestamp: startedAt + offsetMs,
    requestId,
    method,
    endpoint,
    status,
    latency,
    version,
    projectId,
    ...(error !== undefined ? { error } : {}),
  });

  return [
    row(120, id("health-pre"), "GET", "/api/health", 200, 18, bugVersion),
    row(380, id("checkout-fail-1"), "POST", "/api/checkout", 500, s.baselineP95Ms, bugVersion, s.errorFingerprint),
    row(1_100, id("checkout-fail-2"), "POST", "/api/checkout", 500, s.baselineP95Ms + 17, bugVersion, s.errorFingerprint),
    row(2_400, id("fresh-log-read"), "GET", "/__demo/logs", 200, 22, bugVersion),
    row(21_900, id("deploy-health"), "GET", "/api/health", 200, 20, fixedVersion),
    row(25_150, id("verify-pass"), "POST", "/api/checkout", 200, s.postFixP50Ms + 4, fixedVersion),
    row(25_450, id("fresh-log-clean"), "GET", "/__demo/logs", 200, 19, fixedVersion),
    row(26_100, id("perf-sample-1"), "POST", "/api/checkout", 200, s.postFixP50Ms, fixedVersion),
    row(26_420, id("perf-sample-2"), "POST", "/api/checkout", 200, s.postFixP50Ms + 3, fixedVersion),
    row(26_740, id("perf-sample-3"), "POST", "/api/checkout", 200, s.postFixP95Ms, fixedVersion),
  ];
}

async function seedScenarioLogs(ctx: MutationCtx, projectId: Id<"projects">, s: Scenario, startedAt: number) {
  const rows = scenarioLogs(projectId, s, startedAt);
  const existingRows = await ctx.db
    .query("logs")
    .withIndex("by_project_time", (q) =>
      q.eq("projectId", projectId).gte("timestamp", startedAt - 5_000).lte("timestamp", startedAt + 120_000),
    )
    .take(200);
  const existingRequestIds = new Set(existingRows.map((row) => row.requestId));
  let inserted = 0;
  for (const row of rows) {
    if (existingRequestIds.has(row.requestId)) continue;
    await ctx.db.insert("logs", row);
    inserted += 1;
  }
  return inserted;
}

function statusForStage(plan: DemoAgentPlan, stage: DemoStage): DemoRunStatus {
  const current = STAGE_INDEX[stage];
  if (current < STAGE_INDEX[plan.startStage]) return "queued";
  if (current >= STAGE_INDEX[plan.completeStage]) return "succeeded";
  return "running";
}

function demoHex(seed: string, length: number) {
  const hex = "0123456789abcdef";
  let hash = 0x811c9dc5;
  let out = "";
  for (let i = 0; i < length; i++) {
    const code = seed.charCodeAt(i % Math.max(seed.length, 1));
    hash ^= code;
    hash = Math.imul(hash, 0x01000193);
    out += hex[(hash >>> ((i % 8) * 4)) & 0xf];
  }
  return out;
}

function stageForIncidentStatus(status: string, hasRootCause: boolean): DemoStage {
  if (status === "DETECTED" || status === "DIAGNOSING") return "detected";
  if (status === "DIAGNOSIS_REVIEW") return "diagnosis";
  if (["PATCHING", "PATCH_REVIEW", "PR_READY", "AWAITING_APPROVAL"].includes(status)) return "patch";
  if (status === "DEPLOYING") return "deploy";
  if (status === "VERIFYING") return "verify";
  if (status === "PERF_CHECK") return "performance";
  if (status === "RESOLVED") return "resolved";
  return hasRootCause ? "resolved" : "detected";
}

async function syncDemoAgentRuns(ctx: MutationCtx, incidentId: Id<"incidents">, stage: DemoStage) {
  const incident = await ctx.db.get(incidentId);
  if (!incident) throw new Error("INCIDENT_NOT_FOUND");

  const existingRuns = await ctx.db
    .query("agentRuns")
    .withIndex("by_incidentId_and_queuedAt", (q) => q.eq("incidentId", incidentId))
    .take(50);
  const existingEvents = await ctx.db
    .query("events")
    .withIndex("by_incident_time", (q) => q.eq("incidentId", incidentId))
    .take(300);
  const existingObservability = await ctx.db
    .query("observabilityRecords")
    .withIndex("by_incidentId_and_startedAt", (q) => q.eq("incidentId", incidentId))
    .take(100);
  const runsByKey = new Map(existingRuns.map((run) => [run.idempotencyKey, run]));
  const eventKeys = new Set(existingEvents.map((event) => `${event.runId ?? ""}:${event.status}`));
  const observabilityKeys = new Set(existingObservability.map((record) => record.idempotencyKey));
  let commanderRunId: Id<"agentRuns"> | undefined;
  let upserted = 0;
  let eventsInserted = 0;

  async function ensureEvent(
    runId: Id<"agentRuns">,
    status: DemoRunStatus,
    timestamp: number,
    metadata: Record<string, unknown>,
  ) {
    const eventKey = `${runId}:${status}`;
    if (eventKeys.has(eventKey)) return;
    await ctx.db.insert("events", {
      incidentId,
      runId,
      type: "AGENT_RUN",
      status,
      timestamp,
      metadata: { ...metadata, demoSynthetic: true },
    });
    eventKeys.add(eventKey);
    eventsInserted += 1;
  }

  async function ensureObservability(
    runId: Id<"agentRuns">,
    plan: DemoAgentPlan,
    startedAt: number,
    finishedAt: number,
  ) {
    const idempotencyKey = `${incidentId}:demo-observability:${plan.agent}`;
    if (observabilityKeys.has(idempotencyKey)) return;
    const llm = Boolean(plan.model);
    await ctx.db.insert("observabilityRecords", {
      incidentId,
      runId,
      source: llm ? "langfuse" : "local",
      kind: llm ? "generation" : "tool",
      name: `${plan.agent.toLowerCase()}.${llm ? "generation" : "deterministic"}`,
      status: "succeeded",
      idempotencyKey,
      traceId: demoHex(`${incidentId}:${plan.agent}:trace`, 32),
      observationId: demoHex(`${incidentId}:${plan.agent}:observation`, 16),
      provider: plan.provider,
      model: plan.model,
      promptVersion: plan.promptVersion,
      inputSummary: plan.inputSummary,
      outputSummary: plan.outputSummary,
      tokens: plan.tokens,
      cost: plan.cost,
      startedAt,
      finishedAt,
      durationMs: plan.durationMs,
      metadata: { demoSynthetic: true, completeStage: plan.completeStage },
    });
    observabilityKeys.add(idempotencyKey);
  }

  for (const plan of DEMO_AGENT_PLANS) {
    const idempotencyKey = `${incidentId}:demo-agent:${plan.agent}`;
    const targetStatus = statusForStage(plan, stage);
    const queuedAt = incident.startedAt + plan.offsetMs;
    const startedAt = queuedAt + 500;
    const finishedAt = startedAt + plan.durationMs;
    const existing = runsByKey.get(idempotencyKey);
    const parentRunId = plan.agent === "COMMANDER" ? undefined : commanderRunId;
    const status =
      existing && RUN_STATUS_RANK[existing.status as DemoRunStatus] > RUN_STATUS_RANK[targetStatus]
        ? (existing.status as DemoRunStatus)
        : targetStatus;
    const terminal = status === "succeeded";
    const running = status === "running" || terminal;
    const runPatch = {
      incidentId,
      ...(parentRunId ? { parentRunId } : {}),
      agent: plan.agent,
      status,
      idempotencyKey,
      inputSummary: plan.inputSummary,
      outputSummary: terminal ? plan.outputSummary : undefined,
      provider: plan.provider,
      model: plan.model,
      promptVersion: plan.promptVersion,
      tokens: terminal ? plan.tokens : undefined,
      cost: terminal ? plan.cost : undefined,
      durationMs: terminal ? plan.durationMs : undefined,
      queuedAt,
      startedAt: running ? startedAt : undefined,
      finishedAt: terminal ? finishedAt : undefined,
    };
    const runId = existing ? existing._id : await ctx.db.insert("agentRuns", runPatch);
    if (existing) await ctx.db.patch(existing._id, runPatch);
    if (plan.agent === "COMMANDER") commanderRunId = runId;

    const common = {
      agent: plan.agent,
      parentRunId,
      provider: plan.provider,
      model: plan.model,
      promptVersion: plan.promptVersion,
      idempotencyKey,
    };
    await ensureEvent(runId, "queued", queuedAt, common);
    if (running) await ensureEvent(runId, "running", startedAt, common);
    if (terminal) {
      await ensureEvent(runId, "succeeded", finishedAt, {
        ...common,
        durationMs: plan.durationMs,
        tokens: plan.tokens,
        cost: plan.cost,
      });
      await ensureObservability(runId, plan, startedAt, finishedAt);
    }
    upserted += 1;
  }

  return { upserted, eventsInserted };
}

export const seedIncidents = mutation({
  args: {},
  handler: async (ctx) => {
    const project = await ctx.db.query("projects").withIndex("by_repo", (q) => q.eq("repo", `${OWNER}/${REPO}`)).unique();
    if (!project) throw new Error("No checkout-demo project; run `npm run seed` and configure the project first.");

    const created: { incidentId: Id<"incidents">; prNumber: number }[] = [];
    let logsSeeded = 0;

    for (const s of SCENARIOS) {
      const idempotencyKey = `demo-seed-${s.key}`;
      const existing = await ctx.db
        .query("incidents")
        .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
        .unique();
      if (existing) {
        logsSeeded += await seedScenarioLogs(ctx, project._id, s, existing.startedAt);
        await syncDemoAgentRuns(ctx, existing._id, "resolved");
        created.push({ incidentId: existing._id, prNumber: s.prNumber });
        continue;
      }

      const startedAt = Date.now() - s.daysAgo * 24 * 60 * 60 * 1000;
      const prUrl = `https://github.com/${OWNER}/${REPO}/pull/${s.prNumber}`;
      let clock = startedAt;
      const at = (ms: number) => (clock += ms);
      const events: { type: string; status: string; timestamp: number; metadata: unknown }[] = [];
      const state = (status: string, ms: number, metadata: Record<string, unknown> = {}) =>
        events.push({ type: "STATE_TRANSITION", status, timestamp: at(ms), metadata });
      const line = (step: string, ms: number, message: string) =>
        events.push({
          type: "TIMELINE",
          status: step,
          timestamp: at(ms),
          metadata: { step, message, elapsedMs: clock - startedAt },
        });

      // 1. Detect + verify-fail
      state("DETECTED", 0, { source: "auto_detect" });
      line("verify-fail", 400, `prod DOWN → 500: ${s.errorFingerprint}`);

      // 2. Diagnose (LLM proposes; verify gate is the real proof)
      state("DIAGNOSING", 300, { from: "DETECTED" });
      line("diagnose", 5200, `root cause: ${s.rootCause}`);
      state("DIAGNOSIS_REVIEW", 200, { from: "DIAGNOSING", rootCause: s.rootCause });

      // 3. Patch → PR
      state("PATCHING", 300, { from: "DIAGNOSIS_REVIEW" });
      line("pr", 3800, `#${s.prNumber} opened → ${prUrl}`);
      state("PATCH_REVIEW", 200, { from: "PATCHING", pullRequestUrl: prUrl, prNumber: s.prNumber });

      // 4. Merge + redeploy
      state("DEPLOYING", 300, { from: "PATCH_REVIEW", pullRequestUrl: prUrl });
      line("merge", 2600, `PR #${s.prNumber} merged (${s.commitSha.slice(0, 7)})`);
      const deployStartedAt = clock;
      line("deploy", 8400, `deployed version ${s.versionId}`);
      const deployReadyAt = clock;

      // 5. Independent verification (the ONLY proof of recovery)
      state("VERIFYING", 300, { from: "DEPLOYING" });
      const verifyLatency = s.postFixP50Ms + 4;
      line("verify", 3200, `prod → 200 confirmed | assertions PASS | logs clean`);
      const verifyAt = clock;

      // 6. Performance
      state("PERF_CHECK", 300, { from: "VERIFYING" });
      line(
        "perf",
        1800,
        `p50 ${s.postFixP50Ms}ms p95 ${s.postFixP95Ms}ms success 100% (baseline p95 ${s.baselineP95Ms}ms)`,
      );
      const perfAt = clock;

      // 7. Resolve
      const resolvedAt = at(400);
      state("RESOLVED", 0, { from: "PERF_CHECK", pullRequestUrl: prUrl });
      line("resolved", 0, `incident RESOLVED in ${((resolvedAt - startedAt) / 1000).toFixed(1)}s`);

      // Persist: incident first (real id), then evidence, then the event stream.
      const incidentId = await ctx.db.insert("incidents", {
        projectId: project._id,
        source: "auto_detect",
        service: s.service,
        severity: s.severity,
        configuredMode: "AUTO_RESOLVE",
        effectiveMode: "AUTO_RESOLVE",
        status: "RESOLVED",
        startedAt,
        resolvedAt,
        rootCause: s.rootCause,
        confidence: s.confidence,
        resolutionSummary: s.resolutionSummary,
        awaitingApproval: false,
        attempts: { diagnosis: 1, patch: 1, verification: 1 },
        deadlineAt: startedAt + 5 * 60_000,
        budgetUsd: 2,
        idempotencyKey,
      });

      const deploymentId = await ctx.db.insert("deployments", {
        incidentId,
        branch: project.defaultBranch,
        commitSha: s.commitSha,
        productionUrl: PROD,
        status: "deployed",
        externalDeploymentId: s.versionId,
        startedAt: deployStartedAt,
        readyAt: deployReadyAt,
      });
      // RESOLVED invariant: passing independent verification + PASS performance.
      await ctx.db.insert("verifications", {
        incidentId,
        deploymentId,
        request: { method: "POST", path: "/api/checkout", body: CHECKOUT_PAYLOAD },
        responseStatus: 200,
        latencyMs: verifyLatency,
        assertions: { status200: true, confirmed: true, hasOrderId: true },
        passed: true,
        freshLogsClean: true,
        logsCheckedAt: verifyAt,
        verifiedAt: verifyAt,
      });
      await ctx.db.insert("performance", {
        incidentId,
        deploymentId,
        baselineP95Ms: s.baselineP95Ms,
        postFixP50Ms: s.postFixP50Ms,
        postFixP95Ms: s.postFixP95Ms,
        successRate: 1,
        samples: 5,
        verdict: "PASS",
        measuredAt: perfAt,
      });
      for (const e of events) {
        await ctx.db.insert("events", { incidentId, ...e });
      }
      logsSeeded += await seedScenarioLogs(ctx, project._id, s, startedAt);
      await syncDemoAgentRuns(ctx, incidentId, "resolved");

      created.push({ incidentId, prNumber: s.prNumber });
    }

    return { seeded: created.length, logsSeeded, incidents: created };
  },
});

export const syncAgentRuns = mutation({
  args: {
    incidentId: v.id("incidents"),
    stage: v.union(
      v.literal("detected"),
      v.literal("diagnosis"),
      v.literal("patch"),
      v.literal("deploy"),
      v.literal("verify"),
      v.literal("performance"),
      v.literal("resolved"),
    ),
  },
  handler: async (ctx, args) => syncDemoAgentRuns(ctx, args.incidentId, args.stage),
});

export const backfillRootCauses = mutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
    const incidents = await ctx.db.query("incidents").order("desc").take(limit);
    let updated = 0;
    const incidentIds: Id<"incidents">[] = [];

    for (const incident of incidents) {
      if (incident.rootCause) continue;
      const events = await ctx.db
        .query("events")
        .withIndex("by_incident_time", (q) => q.eq("incidentId", incident._id))
        .order("desc")
        .take(100);
      const diagnosis = events.find((event) => {
        const metadata = event.metadata && typeof event.metadata === "object" ? (event.metadata as Record<string, unknown>) : {};
        return event.type === "STATE_TRANSITION" && event.status === "DIAGNOSIS_REVIEW" && typeof metadata.rootCause === "string";
      });
      if (!diagnosis) continue;

      const metadata = diagnosis.metadata as Record<string, unknown>;
      const patch: { rootCause: string; confidence?: number } = { rootCause: String(metadata.rootCause) };
      if (typeof metadata.confidence === "number" && Number.isFinite(metadata.confidence)) {
        patch.confidence = Math.max(0, Math.min(1, metadata.confidence));
      }
      await ctx.db.patch(incident._id, patch);
      updated += 1;
      incidentIds.push(incident._id);
    }

    return { checked: incidents.length, updated, incidentIds };
  },
});

export const backfillAgentRuns = mutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
    const incidents = await ctx.db.query("incidents").order("desc").take(limit);
    let upserted = 0;
    let eventsInserted = 0;
    const incidentIds: Id<"incidents">[] = [];

    for (const incident of incidents) {
      const stage = stageForIncidentStatus(incident.status, !!incident.rootCause);
      const result = await syncDemoAgentRuns(ctx, incident._id, stage);
      upserted += result.upserted;
      eventsInserted += result.eventsInserted;
      incidentIds.push(incident._id);
    }

    return { checked: incidents.length, upserted, eventsInserted, incidentIds };
  },
});
