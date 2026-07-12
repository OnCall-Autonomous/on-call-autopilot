/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function createIncident(t: ReturnType<typeof convexTest>): Promise<Id<"incidents">> {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Checkout",
      owner: "OnCall-Autonomous",
      repo: "OnCall-Autonomous/checkout-demo",
      defaultBranch: "main",
      productionUrl: "https://checkout.example.workers.dev",
      cloudflareProject: "checkout-demo",
      defaultMode: "AUTO_RESOLVE",
      guardrails: {},
      verificationConfig: {},
      baselineLatencyMs: 200,
      createdAt: Date.now(),
    });
    return await ctx.db.insert("incidents", {
      projectId,
      source: "dashboard",
      service: "checkout",
      severity: "SEV2",
      configuredMode: "AUTO_RESOLVE",
      effectiveMode: "AUTO_RESOLVE",
      status: "DETECTED",
      startedAt: Date.now(),
      awaitingApproval: false,
      attempts: { diagnosis: 0, patch: 0, verification: 0 },
      deadlineAt: Date.now() + 300_000,
      budgetUsd: 2,
      idempotencyKey: "incident-agent-runs",
    });
  });
}

describe("agent run observability", () => {
  it("enqueues an idempotent Commander and a child Diagnoser", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncident(t);
    const commanderArgs = {
      incidentId,
      agent: "COMMANDER" as const,
      idempotencyKey: `${incidentId}:commander:1`,
      inputSummary: "Plan recovery",
      provider: "openai",
      model: "gpt-4o-mini",
      promptVersion: "commander-v1",
    };
    const commanderId = await t.mutation(internal.agentRuns.enqueue, commanderArgs);
    expect(await t.mutation(internal.agentRuns.enqueue, commanderArgs)).toBe(commanderId);
    const diagnoserId = await t.mutation(internal.agentRuns.enqueue, {
      incidentId,
      parentRunId: commanderId,
      agent: "DIAGNOSER",
      idempotencyKey: `${incidentId}:diagnoser:1`,
      inputSummary: "Correlate logs and deployments",
      provider: "openai",
      model: "gpt-4o-mini",
      promptVersion: "diagnoser-v1",
    });

    const runs = await t.query(api.agentRuns.listByIncident, { incidentId, limit: 20 });
    expect(runs).toHaveLength(2);
    expect(runs.find((run) => run._id === diagnoserId)?.parentRunId).toBe(commanderId);
    expect(runs.every((run) => run.status === "queued")).toBe(true);
  });

  it("persists lifecycle metrics and emits one event per transition", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncident(t);
    const runId = await t.mutation(internal.agentRuns.enqueue, {
      incidentId,
      agent: "DIAGNOSER",
      idempotencyKey: `${incidentId}:diagnoser:lifecycle`,
      inputSummary: "Diagnose checkout",
      provider: "openai",
      model: "gpt-4o-mini",
      promptVersion: "diagnoser-v1",
    });
    await t.mutation(internal.agentRuns.start, { runId });
    expect(await t.query(api.agentRuns.active, { incidentId, limit: 20 })).toHaveLength(1);
    await t.mutation(internal.agentRuns.succeed, {
      runId,
      outputSummary: "Missing environment binding",
      tokens: 1300,
      cost: 0.04,
    });

    expect(await t.query(api.agentRuns.active, { incidentId, limit: 20 })).toEqual([]);
    const runs = await t.query(api.agentRuns.listByIncident, { incidentId, limit: 20 });
    expect(runs[0]).toMatchObject({ status: "succeeded", tokens: 1300, cost: 0.04 });
    expect(runs[0].durationMs).toBeTypeOf("number");
    const events = await t.run(async (ctx) =>
      ctx.db.query("events").withIndex("by_incident_time", (q) => q.eq("incidentId", incidentId)).collect(),
    );
    expect(events.map((event) => event.status)).toEqual(["queued", "running", "succeeded"]);
    expect(events.every((event) => event.type === "AGENT_RUN" && event.runId === runId)).toBe(true);
  });

  it("records failed and Commander-rejected verdicts", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncident(t);
    const failedId = await t.mutation(internal.agentRuns.enqueue, {
      incidentId,
      agent: "DIAGNOSER",
      idempotencyKey: `${incidentId}:diagnoser:failed`,
      inputSummary: "Diagnose checkout",
      promptVersion: "diagnoser-v1",
    });
    await t.mutation(internal.agentRuns.start, { runId: failedId });
    await t.mutation(internal.agentRuns.fail, {
      runId: failedId,
      errorCode: "MODEL_TIMEOUT",
      outputSummary: "Provider timed out",
      tokens: 25,
      cost: 0.001,
    });
    const rejectedId = await t.mutation(internal.agentRuns.enqueue, {
      incidentId,
      agent: "FIXER",
      idempotencyKey: `${incidentId}:fixer:rejected`,
      inputSummary: "Prepare patch",
      promptVersion: "fixer-v1",
    });
    await t.mutation(internal.agentRuns.start, { runId: rejectedId });
    await t.mutation(internal.agentRuns.reject, {
      runId: rejectedId,
      rejectionReason: "PATCH_OUTSIDE_ALLOWLIST",
      outputSummary: "Patch requested a blocked path",
    });

    const runs = await t.query(api.agentRuns.listByIncident, { incidentId, limit: 20 });
    expect(runs.find((run) => run._id === failedId)).toMatchObject({ status: "failed", errorCode: "MODEL_TIMEOUT" });
    expect(runs.find((run) => run._id === rejectedId)).toMatchObject({ status: "rejected", rejectionReason: "PATCH_OUTSIDE_ALLOWLIST" });
    const events = await t.run(async (ctx) =>
      ctx.db.query("events").withIndex("by_incident_time", (q) => q.eq("incidentId", incidentId)).collect(),
    );
    expect(events.map((event) => event.status)).toEqual(["queued", "running", "failed", "queued", "running", "rejected"]);
  });
});
