import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const evalTrigger = v.union(
  v.literal("pull_request"),
  v.literal("production_failure"),
  v.literal("manual"),
  v.literal("release"),
);

const pipelineSteps = [
  { label: "Prompt or agent PR", detail: "Any change under prompts/, agents/, or runbooks/" },
  { label: "Eval suite in CI", detail: "Regression, rubric, safety, and task-completion checks" },
  { label: "Baseline compare", detail: "Release threshold is enforced against the last green tag" },
  { label: "Release decision", detail: "Merge is blocked when quality drops below the gate" },
];

const configLines = [
  "name: eval-gate",
  "on: [pull_request]",
  "jobs:",
  "  quality:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npm ci",
  "      - run: npm run evals -- --suite changed",
  "      - run: npm run evals:compare -- --fail-below-threshold",
  "      - run: npm run release:lock -- --on-quality-drop",
];

function boundedLimit(value: number | undefined, fallback: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

function capturedCaseName(suiteName: string, failureSourceId: string | undefined, target: string) {
  const source = failureSourceId ?? target;
  return `${suiteName}:${source}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function ensureEvalCase(
  ctx: MutationCtx,
  args: {
    name: string;
    failureMode: string;
    expectedCause: string;
    allowedFiles?: string[];
    expectedAssertions?: string[];
    sourceFailureId?: string;
    sourceRunId?: Id<"evalRuns">;
  },
) {
  const existing = await ctx.db.query("evalCases").withIndex("by_name", (q) => q.eq("name", args.name)).unique();
  if (existing) {
    const patch: Partial<typeof existing> = {};
    if (args.sourceFailureId !== undefined && existing.sourceFailureId === undefined) {
      patch.sourceFailureId = args.sourceFailureId;
    }
    if (args.sourceRunId !== undefined && existing.sourceRunId === undefined) {
      patch.sourceRunId = args.sourceRunId;
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert("evalCases", {
    name: args.name,
    failureMode: args.failureMode,
    expectedCause: args.expectedCause,
    allowedFiles: args.allowedFiles ?? [],
    expectedAssertions: args.expectedAssertions ?? [],
    status: "ACTIVE",
    ...(args.sourceFailureId !== undefined ? { sourceFailureId: args.sourceFailureId } : {}),
    ...(args.sourceRunId !== undefined ? { sourceRunId: args.sourceRunId } : {}),
    createdAt: Date.now(),
  });
}

export const summary = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = boundedLimit(args.limit, 20, 100);
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const [cases, runs, blockedRuns] = await Promise.all([
      ctx.db
        .query("evalCases")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", "ACTIVE"))
        .order("desc")
        .take(100),
      ctx.db.query("evalRuns").withIndex("by_createdAt").order("desc").take(limit),
      ctx.db
        .query("evalRuns")
        .withIndex("by_blockedRelease_and_createdAt", (q) => q.eq("blockedRelease", true).gte("createdAt", since))
        .order("desc")
        .take(100),
    ]);

    const casePairs = await Promise.all(runs.map(async (run) => [run._id, await ctx.db.get(run.evalCaseId)] as const));
    const casesByRun = new Map(casePairs);
    const enrichedRuns = runs.map((run) => {
      const evalCase = casesByRun.get(run._id);
      const score = run.score ?? (run.passed ? 100 : 0);
      const threshold = run.threshold ?? 100;
      return {
        ...run,
        caseName: evalCase?.name ?? "unknown-eval-case",
        failureMode: evalCase?.failureMode ?? "unknown failure mode",
        suiteName: run.suiteName ?? evalCase?.name ?? "eval-suite",
        target: run.target ?? evalCase?.name ?? "unknown target",
        status: run.status ?? (run.passed ? "passed" : "failed"),
        score,
        threshold,
        delta: run.delta ?? score - threshold,
        checkedAt: run.checkedAt ?? run.createdAt,
        blockedRelease: run.blockedRelease ?? false,
        qualityDrop: run.qualityDrop ?? !run.passed,
      };
    });
    const latest = enrichedRuns[0] ?? null;

    return {
      cases,
      runs: enrichedRuns,
      metrics: {
        currentPassRate: latest?.score ?? null,
        releaseThreshold: latest?.threshold ?? 94,
        blockedReleases7d: blockedRuns.length,
        evalSetGrowth: cases.filter((evalCase) => evalCase.sourceFailureId !== undefined || evalCase.sourceRunId !== undefined).length,
        activeCases: cases.length,
      },
      pipeline: { steps: pipelineSteps, configLines },
    };
  },
});

export const createRun = mutation({
  args: {
    evalCaseName: v.optional(v.string()),
    suiteName: v.optional(v.string()),
    target: v.string(),
    trigger: v.optional(evalTrigger),
    promptVersion: v.optional(v.string()),
    agentVersion: v.optional(v.string()),
    score: v.number(),
    threshold: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    releaseId: v.optional(v.string()),
    pullRequest: v.optional(v.string()),
    branch: v.optional(v.string()),
    commitSha: v.optional(v.string()),
    checkedAt: v.optional(v.number()),
    failureMode: v.optional(v.string()),
    expectedCause: v.optional(v.string()),
    allowedFiles: v.optional(v.array(v.string())),
    expectedAssertions: v.optional(v.array(v.string())),
    invariantResults: v.optional(v.any()),
    failureSourceId: v.optional(v.string()),
    failureSummary: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.score)) throw new Error("score must be a finite number");
    const threshold = args.threshold ?? 94;
    if (!Number.isFinite(threshold)) throw new Error("threshold must be a finite number");
    if (args.idempotencyKey !== undefined) {
      const existing = await ctx.db
        .query("evalRuns")
        .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
        .unique();
      if (existing) return existing._id;
    }

    const suiteName = args.suiteName ?? "ci-release-gate";
    const evalCaseName = args.evalCaseName ?? suiteName;
    const passed = args.score >= threshold;
    const status = passed ? "passed" : "blocked";
    const now = Date.now();
    const primaryCaseId = await ensureEvalCase(ctx, {
      name: evalCaseName,
      failureMode: args.failureMode ?? "CI quality gate regression",
      expectedCause: args.expectedCause ?? "Quality score must stay above the release threshold",
      allowedFiles: args.allowedFiles,
      expectedAssertions: args.expectedAssertions ?? ["score >= release threshold", "quality drop blocks release"],
    });
    const capturedName = !passed
      ? capturedCaseName(suiteName, args.failureSourceId, args.target)
      : undefined;

    const runId = await ctx.db.insert("evalRuns", {
      evalCaseId: primaryCaseId,
      promptVersion: args.promptVersion ?? "prompt@working-tree",
      agentVersion: args.agentVersion ?? "agent@working-tree",
      passed,
      invariantResults:
        args.invariantResults ?? {
          releaseThreshold: args.score >= threshold,
          qualityDropBlocked: !passed,
          capturedForRegression: !passed,
        },
      durationMs: args.durationMs ?? 0,
      costUsd: args.costUsd ?? 0,
      createdAt: now,
      suiteName,
      target: args.target,
      trigger: args.trigger ?? "manual",
      status,
      score: args.score,
      threshold,
      delta: args.score - threshold,
      checkedAt: args.checkedAt ?? now,
      blockedRelease: !passed,
      qualityDrop: !passed,
      ...(args.releaseId !== undefined ? { releaseId: args.releaseId } : {}),
      ...(args.pullRequest !== undefined ? { pullRequest: args.pullRequest } : {}),
      ...(args.branch !== undefined ? { branch: args.branch } : {}),
      ...(args.commitSha !== undefined ? { commitSha: args.commitSha } : {}),
      ...(args.failureSourceId !== undefined ? { failureSourceId: args.failureSourceId } : {}),
      ...(capturedName !== undefined ? { capturedEvalCaseName: capturedName } : {}),
      ...(args.idempotencyKey !== undefined ? { idempotencyKey: args.idempotencyKey } : {}),
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    });

    if (!passed && capturedName !== undefined) {
      await ensureEvalCase(ctx, {
        name: capturedName,
        failureMode: `auto-captured regression from ${args.failureSourceId ?? args.target}`,
        expectedCause: args.failureSummary ?? "Failed eval run must remain in the regression set",
        allowedFiles: args.allowedFiles,
        expectedAssertions: args.expectedAssertions ?? ["release remains blocked until score recovers"],
        sourceFailureId: args.failureSourceId,
        sourceRunId: runId,
      });
    }

    return runId;
  },
});
