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

const OWNER = "OnCall-Autonomous";
const REPO = "checkout-demo";
const PROD = "https://checkout-demo.ashishsoni2002.workers.dev";
const CHECKOUT_PAYLOAD = { items: [{ id: "sku_1", qty: 2 }], userId: "u_123" };

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

      created.push({ incidentId, prNumber: s.prNumber });
    }

    return { seeded: created.length, logsSeeded, incidents: created };
  },
});
