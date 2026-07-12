/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const incidentRequest = (projectId: Id<"projects">, idempotencyKey = "request-1") => ({
  projectId,
  source: "dashboard" as const,
  service: "checkout",
  severity: "SEV2" as const,
  configuredMode: "AUTO_RESOLVE" as const,
  idempotencyKey,
});

async function insertProject(t: ReturnType<typeof convexTest>, repo: string) {
  return await t.run(async (ctx) =>
    ctx.db.insert("projects", {
      name: repo,
      owner: "OnCall-Autonomous",
      repo,
      defaultBranch: "main",
      productionUrl: `https://${repo}.example.com`,
      cloudflareProject: repo,
      defaultMode: "PR_APPROVAL",
      guardrails: {},
      verificationConfig: {},
      baselineLatencyMs: 500,
      createdAt: Date.now(),
    }),
  );
}

async function databaseCounts(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ({
    incidents: (await ctx.db.query("incidents").collect()).length,
    initialEvents: (await ctx.db.query("events").collect()).filter(
      (event) => event.type === "STATE_TRANSITION" && event.status === "DETECTED",
    ).length,
  }));
}

describe("incidents.create idempotency", () => {
  test("first create produces one incident and one initial state transition", async () => {
    const t = convexTest(schema, modules);
    const projectId = await insertProject(t, "checkout-demo");

    const incidentId = await t.mutation(api.incidents.create, incidentRequest(projectId));

    expect(incidentId).toBeTruthy();
    expect(await databaseCounts(t)).toEqual({ incidents: 1, initialEvents: 1 });
  });

  test("exact replay returns the same ID without duplicate records", async () => {
    const t = convexTest(schema, modules);
    const projectId = await insertProject(t, "checkout-demo");
    const request = incidentRequest(projectId);

    const firstId = await t.mutation(api.incidents.create, request);
    const replayId = await t.mutation(api.incidents.create, request);

    expect(replayId).toEqual(firstId);
    expect(await databaseCounts(t)).toEqual({ incidents: 1, initialEvents: 1 });
  });

  test.each([
    ["project", async (t: ReturnType<typeof convexTest>, request: ReturnType<typeof incidentRequest>) => ({ ...request, projectId: await insertProject(t, "payments-demo") })],
    ["service", async (_t: ReturnType<typeof convexTest>, request: ReturnType<typeof incidentRequest>) => ({ ...request, service: "payments" })],
    ["configured mode", async (_t: ReturnType<typeof convexTest>, request: ReturnType<typeof incidentRequest>) => ({ ...request, configuredMode: "INVESTIGATE_ONLY" as const })],
    ["severity", async (_t: ReturnType<typeof convexTest>, request: ReturnType<typeof incidentRequest>) => ({ ...request, severity: "SEV1" as const })],
    ["source", async (_t: ReturnType<typeof convexTest>, request: ReturnType<typeof incidentRequest>) => ({ ...request, source: "webhook" as const })],
  ])("rejects a reused key with mismatched %s", async (_field, changeRequest) => {
    const t = convexTest(schema, modules);
    const projectId = await insertProject(t, "checkout-demo");
    const request = incidentRequest(projectId);
    await t.mutation(api.incidents.create, request);

    await expect(t.mutation(api.incidents.create, await changeRequest(t, request))).rejects.toThrow(
      "IDEMPOTENCY_KEY_PAYLOAD_CONFLICT",
    );
    expect(await databaseCounts(t)).toEqual({ incidents: 1, initialEvents: 1 });
  });

  test("different key with identical payload creates a distinct incident", async () => {
    const t = convexTest(schema, modules);
    const projectId = await insertProject(t, "checkout-demo");

    const firstId = await t.mutation(api.incidents.create, incidentRequest(projectId, "request-1"));
    const secondId = await t.mutation(api.incidents.create, incidentRequest(projectId, "request-2"));

    expect(secondId).not.toEqual(firstId);
    expect(await databaseCounts(t)).toEqual({ incidents: 2, initialEvents: 2 });
  });
});
