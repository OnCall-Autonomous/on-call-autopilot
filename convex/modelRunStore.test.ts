/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function createRun(t: ReturnType<typeof convexTest>, agent: "COMMANDER" | "DIAGNOSER" | "VERIFIER" = "DIAGNOSER") {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Checkout", owner: "team", repo: "team/checkout", defaultBranch: "main",
      productionUrl: "https://example.com", cloudflareProject: "checkout", defaultMode: "INVESTIGATE_ONLY",
      guardrails: {}, verificationConfig: {}, baselineLatencyMs: 200, createdAt: Date.now(),
    });
    const incidentId = await ctx.db.insert("incidents", {
      projectId, source: "dashboard", service: "checkout", severity: "SEV2",
      configuredMode: "INVESTIGATE_ONLY", effectiveMode: "INVESTIGATE_ONLY", status: "DETECTED",
      startedAt: Date.now(), awaitingApproval: false, attempts: { diagnosis: 0, patch: 0, verification: 0 },
      deadlineAt: Date.now() + 300_000, budgetUsd: 2, idempotencyKey: `model-${agent}`,
    });
    await ctx.db.insert("modelProfiles", {
      agent, kind: agent === "VERIFIER" ? "deterministic" : "llm",
      provider: agent === "VERIFIER" ? undefined : "openai",
      model: agent === "VERIFIER" ? undefined : "gpt-4o-mini",
      promptVersion: `${agent.toLowerCase()}-v1`, enabled: true, updatedAt: Date.now(),
    });
    const runId = await ctx.db.insert("agentRuns", {
      incidentId, agent, status: "running", idempotencyKey: `${incidentId}:${agent}`,
      inputSummary: "authorization: Bearer [REDACTED]", provider: agent === "VERIFIER" ? undefined : "openai",
      model: agent === "VERIFIER" ? undefined : "gpt-4o-mini", promptVersion: `${agent.toLowerCase()}-v1`,
      queuedAt: Date.now(), startedAt: Date.now(),
    });
    return { incidentId, runId };
  });
}

async function getRun(t: ReturnType<typeof convexTest>, runId: Id<"agentRuns">) {
  return await t.run((ctx) => ctx.db.get("agentRuns", runId));
}

describe("model run persistence", () => {
  it("persists successful provider telemetry", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await createRun(t);
    await t.mutation(internal.modelRunStore.succeed, {
      runId, provider: "openai", model: "gpt-4o-mini", promptVersion: "diagnoser-v1",
      inputSummary: "safe input", outputSummary: "safe output", tokens: 150, cost: 0, latencyMs: 42,
    });
    expect(await getRun(t, runId)).toMatchObject({
      status: "succeeded", provider: "openai", model: "gpt-4o-mini",
      promptVersion: "diagnoser-v1", inputSummary: "safe input", outputSummary: "safe output",
      tokens: 150, cost: 0, durationMs: 42,
    });
  });

  it("persists stable failure telemetry", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await createRun(t, "COMMANDER");
    await t.mutation(internal.modelRunStore.fail, {
      runId, errorCode: "MODEL_RATE_LIMITED", outputSummary: "OpenAI rate limit exceeded", latencyMs: 17,
    });
    expect(await getRun(t, runId)).toMatchObject({ status: "failed", errorCode: "MODEL_RATE_LIMITED", durationMs: 17 });
  });

  it("rejects terminal overwrites and non-read-only agents", async () => {
    const t = convexTest(schema, modules);
    const { runId } = await createRun(t);
    await t.mutation(internal.modelRunStore.succeed, {
      runId, provider: "openai", model: "gpt-4o-mini", promptVersion: "diagnoser-v1",
      inputSummary: "safe", outputSummary: "done", tokens: 1, cost: 0, latencyMs: 1,
    });
    await expect(t.mutation(internal.modelRunStore.fail, {
      runId, errorCode: "MODEL_PROVIDER_ERROR", outputSummary: "duplicate", latencyMs: 2,
    })).rejects.toThrow("AGENT_RUN_NOT_RUNNING");

    const verifier = await createRun(t, "VERIFIER");
    await expect(t.query(internal.modelRunStore.load, { runId: verifier.runId })).rejects.toThrow("MODEL_AGENT_NOT_READ_ONLY");
  });
});
