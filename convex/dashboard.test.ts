/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
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
});
