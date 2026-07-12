/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("evaluation release gates", () => {
  it("creates a blocked CI eval run and feeds it back into the eval set", async () => {
    const t = convexTest(schema, modules);

    const runId = await t.mutation(api.evaluations.createRun, {
      evalCaseName: "marketing-landing-page-copy-quality",
      suiteName: "landing-page-copy",
      target: "marketing-crew prompt PR #214",
      trigger: "pull_request",
      promptVersion: "marketing-crew@pr-214",
      agentVersion: "copy-agent@v4",
      score: 88.6,
      threshold: 92,
      durationMs: 48_200,
      costUsd: 0.37,
      releaseId: "rel-2026.07.07.2",
      pullRequest: "#214",
      branch: "prompt/marketing-landing-copy",
      commitSha: "9f3a2c1",
      failureSourceId: "eval-7841",
      failureSummary: "Landing-page copy scored below the release threshold.",
      idempotencyKey: "eval-gate:test:blocked",
    });

    expect(await t.mutation(api.evaluations.createRun, {
      target: "marketing-crew prompt PR #214",
      score: 88.6,
      threshold: 92,
      idempotencyKey: "eval-gate:test:blocked",
    })).toBe(runId);

    const summary = await t.query(api.evaluations.summary, { limit: 10 });

    expect(summary.runs[0]).toMatchObject({
      _id: runId,
      caseName: "marketing-landing-page-copy-quality",
      suiteName: "landing-page-copy",
      status: "blocked",
      blockedRelease: true,
      qualityDrop: true,
      score: 88.6,
      threshold: 92,
      releaseId: "rel-2026.07.07.2",
    });
    expect(summary.runs[0].delta).toBeCloseTo(-3.4);
    expect(summary.metrics.blockedReleases7d).toBe(1);
    expect(summary.metrics.evalSetGrowth).toBe(1);
    expect(summary.cases.some((evalCase) => evalCase.sourceRunId === runId)).toBe(true);
  });

  it("records a passing eval run without blocking release", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.evaluations.createRun, {
      evalCaseName: "support-escalation-loop",
      suiteName: "human-escalation-loop",
      target: "support-agent v4.2",
      trigger: "release",
      promptVersion: "support-agent@v4",
      agentVersion: "support-agent@v4",
      score: 96.4,
      threshold: 94,
    });

    const summary = await t.query(api.evaluations.summary, { limit: 10 });

    expect(summary.runs[0]).toMatchObject({
      status: "passed",
      blockedRelease: false,
      qualityDrop: false,
      score: 96.4,
      threshold: 94,
    });
    expect(summary.metrics.blockedReleases7d).toBe(0);
  });
});
