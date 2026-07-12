/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const originalToken = process.env.AGENT_WORKER_TOKEN;

afterEach(() => {
  process.env.AGENT_WORKER_TOKEN = originalToken;
});

async function createQueuedRun(t: ReturnType<typeof convexTest>): Promise<Id<"agentRuns">> {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Checkout", owner: "OnCall-Autonomous", repo: "OnCall-Autonomous/checkout-demo",
      defaultBranch: "main", productionUrl: "https://checkout-demo.example.workers.dev",
      cloudflareProject: "checkout-demo", defaultMode: "AUTO_RESOLVE", guardrails: {},
      verificationConfig: {}, baselineLatencyMs: 200, createdAt: Date.now(),
    });
    const incidentId = await ctx.db.insert("incidents", {
      projectId, source: "dashboard", service: "checkout", severity: "SEV2",
      configuredMode: "AUTO_RESOLVE", effectiveMode: "AUTO_RESOLVE", status: "DETECTED",
      startedAt: Date.now(), awaitingApproval: false,
      attempts: { diagnosis: 0, patch: 0, verification: 0 },
      deadlineAt: Date.now() + 300_000, budgetUsd: 2, idempotencyKey: "worker-test",
    });
    return await ctx.db.insert("agentRuns", {
      incidentId, agent: "DIAGNOSER", status: "queued", idempotencyKey: "worker-run",
      inputSummary: "Diagnose checkout", promptVersion: "diagnoser-v1", queuedAt: Date.now(),
    });
  });
}

describe("agent worker gateway", () => {
  it("authenticates and atomically claims a queued run", async () => {
    process.env.AGENT_WORKER_TOKEN = "test-worker-token";
    const t = convexTest(schema, modules);
    const runId = await createQueuedRun(t);
    await expect(t.mutation(api.agentWorker.claimNext, { token: "wrong", workerId: "worker-1" }))
      .rejects.toThrow("UNAUTHORIZED_WORKER");

    const claimed = await t.mutation(api.agentWorker.claimNext, {
      token: "test-worker-token", workerId: "worker-1",
    });
    expect(claimed?._id).toBe(runId);
    expect(claimed?.status).toBe("running");
    expect(claimed?.leaseExpiresAt).toBeTypeOf("number");
    expect(await t.mutation(api.agentWorker.claimNext, {
      token: "test-worker-token", workerId: "worker-2",
    })).toBeNull();
  });

  it("persists a successful worker result and lifecycle event", async () => {
    process.env.AGENT_WORKER_TOKEN = "test-worker-token";
    const t = convexTest(schema, modules);
    const runId = await createQueuedRun(t);
    await t.mutation(api.agentWorker.claimNext, { token: "test-worker-token", workerId: "worker-1" });
    await t.mutation(api.agentWorker.complete, {
      token: "test-worker-token", workerId: "worker-1", runId,
      outputSummary: "Root cause identified", durationMs: 42,
    });
    const run = await t.run((ctx) => ctx.db.get("agentRuns", runId));
    expect(run).toMatchObject({ status: "succeeded", outputSummary: "Root cause identified", durationMs: 42 });
  });
});
