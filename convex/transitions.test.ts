/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function createIncident(t: ReturnType<typeof convexTest>): Promise<Id<"incidents">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
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
      createdAt: now,
    });
    return await ctx.db.insert("incidents", {
      projectId,
      source: "auto_detect",
      service: "checkout",
      severity: "SEV1",
      configuredMode: "AUTO_RESOLVE",
      effectiveMode: "AUTO_RESOLVE",
      status: "DETECTED",
      startedAt: now,
      awaitingApproval: false,
      attempts: { diagnosis: 0, patch: 0, verification: 0 },
      deadlineAt: now + 300_000,
      budgetUsd: 2,
      idempotencyKey: "transition-root-cause",
    });
  });
}

describe("incident transitions", () => {
  it("persists diagnosis metadata onto the incident", async () => {
    const t = convexTest(schema, modules);
    const incidentId = await createIncident(t);

    await t.mutation(api.transitions.move, { incidentId, to: "DIAGNOSING" });
    await t.mutation(api.transitions.move, {
      incidentId,
      to: "DIAGNOSIS_REVIEW",
      metadata: {
        rootCause: "Checkout read i.pricing.cost even though LineItem exposes i.price.",
        confidence: 0.94,
      },
    });

    const incident = await t.query(api.incidents.get, { incidentId });
    expect(incident).toMatchObject({
      status: "DIAGNOSIS_REVIEW",
      rootCause: "Checkout read i.pricing.cost even though LineItem exposes i.price.",
      confidence: 0.94,
    });
  });
});
