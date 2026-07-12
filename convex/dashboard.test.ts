/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function createIncidentWithLogs(t: ReturnType<typeof convexTest>): Promise<Id<"incidents">> {
  return await t.run(async (ctx) => {
    const startedAt = Date.now();
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
      createdAt: startedAt,
    });
    const incidentId = await ctx.db.insert("incidents", {
      projectId,
      source: "dashboard",
      service: "checkout",
      severity: "SEV2",
      configuredMode: "AUTO_RESOLVE",
      effectiveMode: "AUTO_RESOLVE",
      status: "RESOLVED",
      startedAt,
      resolvedAt: startedAt + 10_000,
      awaitingApproval: false,
      attempts: { diagnosis: 1, patch: 1, verification: 1 },
      deadlineAt: startedAt + 300_000,
      budgetUsd: 2,
      idempotencyKey: "dashboard-detail-logs",
    });

    await ctx.db.insert("logs", {
      projectId,
      timestamp: startedAt - 10_000,
      endpoint: "/api/checkout",
      method: "POST",
      status: 500,
      latency: 90,
      error: "outside incident window",
      requestId: "outside-window",
      version: "old",
    });
    await ctx.db.insert("logs", {
      projectId,
      timestamp: startedAt + 500,
      endpoint: "/api/checkout",
      method: "POST",
      status: 500,
      latency: 90,
      error: "Cannot read properties of undefined",
      requestId: "failure",
      version: "bug",
    });
    await ctx.db.insert("logs", {
      projectId,
      timestamp: startedAt + 9_500,
      endpoint: "/api/checkout",
      method: "POST",
      status: 200,
      latency: 62,
      requestId: "verified",
      version: "fixed",
    });

    return incidentId;
  });
}

describe("dashboard detail", () => {
  it("includes service logs from the incident window", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncidentWithLogs(t);

    const detail = await t.query(api.dashboard.incidentDetail, { incidentId });

    expect(detail?.logs.map((log) => log.requestId)).toEqual(["failure", "verified"]);
    expect(detail?.logs[0]).toMatchObject({
      endpoint: "/api/checkout",
      status: 500,
      error: "Cannot read properties of undefined",
    });
  });

  it("includes synthetic demo agent runs and run events", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncidentWithLogs(t);

    await t.mutation(api.demoSeed.syncAgentRuns, { incidentId, stage: "resolved" });
    const detail = await t.query(api.dashboard.incidentDetail, { incidentId });

    expect(detail?.runs.map((run) => run.agent)).toEqual([
      "COMMANDER",
      "DIAGNOSER",
      "TEMP_SPECIALIST",
      "FIXER",
      "VERIFIER",
      "PERFORMANCE",
      "REPORTER",
    ]);
    expect(detail?.runs.every((run) => run.status === "succeeded")).toBe(true);
    expect(detail?.runs.find((run) => run.agent === "DIAGNOSER")).toMatchObject({
      tokens: 2840,
      cost: 0.034,
    });
    expect(detail?.events.filter((event) => event.type === "AGENT_RUN" && event.status === "succeeded")).toHaveLength(7);
  });

  it("includes workflow steps with costing for the incident detail UI", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncidentWithLogs(t);
    const stepId = await t.mutation(internal.workflowSteps.schedule, {
      incidentId,
      type: "DIAGNOSE",
      idempotencyKey: `${incidentId}:diagnose:detail`,
      timeoutMs: 30_000,
    });
    await t.mutation(internal.workflowSteps.start, { stepId });
    await t.mutation(internal.workflowSteps.succeed, {
      stepId,
      outputSummary: "Diagnosis accepted",
      tokens: 2840,
      cost: 0.034,
    });

    const detail = await t.query(api.dashboard.incidentDetail, { incidentId });

    expect(detail?.steps).toHaveLength(1);
    expect(detail?.steps[0]).toMatchObject({
      _id: stepId,
      type: "DIAGNOSE",
      status: "succeeded",
      tokens: 2840,
      cost: 0.034,
    });
  });

  it("includes Langfuse/local observability records for the incident detail UI", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncidentWithLogs(t);

    await t.mutation(api.observability.record, {
      incidentId,
      source: "langfuse",
      kind: "generation",
      name: "diagnose.openai",
      status: "succeeded",
      idempotencyKey: `${incidentId}:observability:diagnose`,
      traceId: "0123456789abcdef0123456789abcdef",
      observationId: "0123456789abcdef",
      provider: "openai",
      model: "gpt-4o",
      inputSummary: "Diagnose checkout 5xx",
      outputSummary: "Found pricing.cost mismatch",
      tokens: 812,
      startedAt: Date.now(),
      finishedAt: Date.now() + 250,
      metadata: { promptVersion: "diagnoser-v1" },
    });

    const detail = await t.query(api.dashboard.incidentDetail, { incidentId });

    expect(detail?.observability).toHaveLength(1);
    expect(detail?.observability[0]).toMatchObject({
      source: "langfuse",
      kind: "generation",
      status: "succeeded",
      traceId: "0123456789abcdef0123456789abcdef",
    });
  });
});
