/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function createIncident(
  t: ReturnType<typeof convexTest>,
  idempotencyKey: string,
): Promise<Id<"incidents">> {
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
      createdAt: 1,
    });
    return await ctx.db.insert("incidents", {
      projectId,
      source: "dashboard",
      service: "checkout",
      severity: "SEV2",
      configuredMode: "AUTO_RESOLVE",
      effectiveMode: "AUTO_RESOLVE",
      status: "DETECTED",
      startedAt: 1,
      awaitingApproval: false,
      attempts: { diagnosis: 0, patch: 0, verification: 0 },
      deadlineAt: 300_001,
      budgetUsd: 2,
      idempotencyKey,
    });
  });
}

async function insertWorkflowStep(
  t: ReturnType<typeof convexTest>,
  incidentId: Id<"incidents">,
  type: "PLAN" | "DIAGNOSE",
  scheduledAt: number,
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("workflowSteps", {
      incidentId,
      type,
      status: "scheduled",
      attempt: 1,
      idempotencyKey: `${incidentId}:${type}:${scheduledAt}`,
      scheduledAt,
      timeoutMs: 30_000,
    }),
  );
}

describe("incident detail", () => {
  it("includes only the incident's workflow steps in scheduled order", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncident(t, "incident-detail");
    const otherIncidentId = await createIncident(t, "other-incident");
    const laterStepId = await insertWorkflowStep(t, incidentId, "DIAGNOSE", 200);
    const earlierStepId = await insertWorkflowStep(t, incidentId, "PLAN", 100);
    await insertWorkflowStep(t, otherIncidentId, "PLAN", 50);

    const detail = await t.query(api.dashboard.incidentDetail, { incidentId });

    expect(detail?.workflowSteps.map((step) => step._id)).toEqual([earlierStepId, laterStepId]);
    expect(detail?.workflowSteps.every((step) => step.incidentId === incidentId)).toBe(true);
  });

  it("returns an empty workflow step array when the incident has no steps", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncident(t, "incident-without-steps");

    const detail = await t.query(api.dashboard.incidentDetail, { incidentId });

    expect(detail?.workflowSteps).toEqual([]);
  });
});
