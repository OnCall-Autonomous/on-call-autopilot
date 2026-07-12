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
      idempotencyKey: "incident-1",
    });
  });
}

describe("workflow step persistence", () => {
  it("returns the same step for duplicate idempotency keys", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncident(t);
    const args = {
      incidentId,
      type: "PLAN" as const,
      idempotencyKey: `${incidentId}:plan:1`,
      timeoutMs: 30_000,
      inputSummary: "Plan incident recovery",
    };

    const first = await t.mutation(internal.workflowSteps.schedule, args);
    const duplicate = await t.mutation(internal.workflowSteps.schedule, args);
    const steps = await t.query(api.workflowSteps.listByIncident, { incidentId, limit: 20 });

    expect(duplicate).toBe(first);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ type: "PLAN", status: "scheduled", attempt: 1 });
  });

  it("persists a resumable start and terminal completion", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncident(t);
    const stepId = await t.mutation(internal.workflowSteps.schedule, {
      incidentId,
      type: "DIAGNOSE",
      idempotencyKey: `${incidentId}:diagnose:1`,
      timeoutMs: 30_000,
    });

    await t.mutation(internal.workflowSteps.start, { stepId });
    const running = await t.query(api.workflowSteps.listResumable, { incidentId, limit: 20 });
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ _id: stepId, status: "running" });

    await t.mutation(internal.workflowSteps.succeed, { stepId, outputSummary: "Diagnosis accepted" });
    const resumable = await t.query(api.workflowSteps.listResumable, { incidentId, limit: 20 });
    const steps = await t.query(api.workflowSteps.listByIncident, { incidentId, limit: 20 });
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("events")
        .withIndex("by_incident_time", (q) => q.eq("incidentId", incidentId))
        .collect(),
    );
    expect(resumable).toEqual([]);
    expect(steps[0]).toMatchObject({ status: "succeeded", outputSummary: "Diagnosis accepted" });
    expect(steps[0].startedAt).toBeTypeOf("number");
    expect(steps[0].finishedAt).toBeTypeOf("number");
    expect(events.map((event) => event.status)).toEqual(["scheduled", "running", "succeeded"]);
    expect(events.every((event) => event.type === "WORKFLOW_STEP")).toBe(true);
  });

  it("persists a typed terminal failure", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncident(t);
    const stepId = await t.mutation(internal.workflowSteps.schedule, {
      incidentId,
      type: "PLAN",
      idempotencyKey: `${incidentId}:plan:failure`,
      timeoutMs: 30_000,
    });
    await t.mutation(internal.workflowSteps.start, { stepId });
    await t.mutation(internal.workflowSteps.fail, { stepId, errorCode: "MODEL_TIMEOUT", outputSummary: "Planning timed out" });

    const steps = await t.query(api.workflowSteps.listByIncident, { incidentId, limit: 20 });
    expect(steps[0]).toMatchObject({ status: "failed", errorCode: "MODEL_TIMEOUT", outputSummary: "Planning timed out" });
    expect(await t.query(api.workflowSteps.listResumable, { incidentId, limit: 20 })).toEqual([]);
  });
});
