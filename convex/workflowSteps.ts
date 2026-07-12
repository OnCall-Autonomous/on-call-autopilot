import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const stepType = v.union(
  v.literal("PLAN"),
  v.literal("DIAGNOSE"),
  v.literal("PATCH"),
  v.literal("DEPLOY"),
  v.literal("VERIFY"),
  v.literal("PERFORMANCE"),
  v.literal("REPORT"),
  v.literal("SELECT_ASSIGNEE"),
  v.literal("ROLLBACK"),
  v.literal("ESCALATE"),
);

function costMetadata(args: { tokens?: number; cost?: number; durationMs?: number }) {
  return {
    ...(args.tokens !== undefined ? { tokens: args.tokens } : {}),
    ...(args.cost !== undefined ? { cost: args.cost } : {}),
    ...(args.durationMs !== undefined ? { durationMs: args.durationMs } : {}),
  };
}

export const schedule = internalMutation({
  args: {
    incidentId: v.id("incidents"),
    runId: v.optional(v.id("agentRuns")),
    type: stepType,
    idempotencyKey: v.string(),
    timeoutMs: v.number(),
    inputSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workflowSteps")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();
    if (existing) return existing._id;

    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) throw new Error("INCIDENT_NOT_FOUND");
    if (args.timeoutMs <= 0) throw new Error("WORKFLOW_STEP_TIMEOUT_MUST_BE_POSITIVE");

    const scheduledAt = Date.now();
    const stepId = await ctx.db.insert("workflowSteps", {
      incidentId: args.incidentId,
      runId: args.runId,
      type: args.type,
      status: "scheduled",
      attempt: 1,
      idempotencyKey: args.idempotencyKey,
      inputSummary: args.inputSummary,
      scheduledAt,
      timeoutMs: args.timeoutMs,
    });
    await ctx.db.insert("events", {
      incidentId: args.incidentId,
      runId: args.runId,
      type: "WORKFLOW_STEP",
      status: "scheduled",
      timestamp: scheduledAt,
      metadata: { stepId, stepType: args.type, attempt: 1, idempotencyKey: args.idempotencyKey },
    });
    return stepId;
  },
});

export const start = internalMutation({
  args: { stepId: v.id("workflowSteps") },
  handler: async (ctx, args) => {
    const step = await ctx.db.get("workflowSteps", args.stepId);
    if (!step) throw new Error("WORKFLOW_STEP_NOT_FOUND");
    if (step.status === "running") return step._id;
    if (step.status !== "scheduled") throw new Error("WORKFLOW_STEP_NOT_STARTABLE");
    const startedAt = Date.now();
    await ctx.db.patch("workflowSteps", step._id, { status: "running", startedAt });
    await ctx.db.insert("events", {
      incidentId: step.incidentId,
      runId: step.runId,
      type: "WORKFLOW_STEP",
      status: "running",
      timestamp: startedAt,
      metadata: { stepId: step._id, stepType: step.type, attempt: step.attempt },
    });
    return step._id;
  },
});

export const succeed = internalMutation({
  args: {
    stepId: v.id("workflowSteps"),
    outputSummary: v.optional(v.string()),
    tokens: v.optional(v.number()),
    cost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db.get("workflowSteps", args.stepId);
    if (!step) throw new Error("WORKFLOW_STEP_NOT_FOUND");
    if (step.status !== "running" || step.startedAt === undefined) throw new Error("WORKFLOW_STEP_NOT_RUNNING");
    const finishedAt = Date.now();
    const durationMs = finishedAt - step.startedAt;
    await ctx.db.patch("workflowSteps", step._id, {
      status: "succeeded",
      outputSummary: args.outputSummary,
      tokens: args.tokens,
      cost: args.cost,
      durationMs,
      finishedAt,
    });
    await ctx.db.insert("events", {
      incidentId: step.incidentId,
      runId: step.runId,
      type: "WORKFLOW_STEP",
      status: "succeeded",
      timestamp: finishedAt,
      metadata: {
        stepId: step._id,
        stepType: step.type,
        attempt: step.attempt,
        ...costMetadata({ tokens: args.tokens, cost: args.cost, durationMs }),
      },
    });
    return step._id;
  },
});

export const fail = internalMutation({
  args: {
    stepId: v.id("workflowSteps"),
    errorCode: v.string(),
    outputSummary: v.optional(v.string()),
    tokens: v.optional(v.number()),
    cost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db.get("workflowSteps", args.stepId);
    if (!step) throw new Error("WORKFLOW_STEP_NOT_FOUND");
    if (step.status !== "running" || step.startedAt === undefined) throw new Error("WORKFLOW_STEP_NOT_RUNNING");
    const finishedAt = Date.now();
    const durationMs = finishedAt - step.startedAt;
    await ctx.db.patch("workflowSteps", step._id, {
      status: "failed",
      errorCode: args.errorCode,
      outputSummary: args.outputSummary,
      tokens: args.tokens,
      cost: args.cost,
      durationMs,
      finishedAt,
    });
    await ctx.db.insert("events", {
      incidentId: step.incidentId,
      runId: step.runId,
      type: "WORKFLOW_STEP",
      status: "failed",
      timestamp: finishedAt,
      metadata: {
        stepId: step._id,
        stepType: step.type,
        attempt: step.attempt,
        errorCode: args.errorCode,
        ...costMetadata({ tokens: args.tokens, cost: args.cost, durationMs }),
      },
    });
    return step._id;
  },
});

export const listByIncident = query({
  args: {
    incidentId: v.id("incidents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    return await ctx.db
      .query("workflowSteps")
      .withIndex("by_incidentId_and_scheduledAt", (q) => q.eq("incidentId", args.incidentId))
      .order("desc")
      .take(limit);
  },
});

export const listResumable = query({
  args: {
    incidentId: v.id("incidents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    const [scheduled, running] = await Promise.all([
      ctx.db
        .query("workflowSteps")
        .withIndex("by_incidentId_and_status_and_scheduledAt", (q) =>
          q.eq("incidentId", args.incidentId).eq("status", "scheduled"),
        )
        .order("asc")
        .take(limit),
      ctx.db
        .query("workflowSteps")
        .withIndex("by_incidentId_and_status_and_scheduledAt", (q) =>
          q.eq("incidentId", args.incidentId).eq("status", "running"),
        )
        .order("asc")
        .take(limit),
    ]);
    return [...scheduled, ...running].sort((a, b) => a.scheduledAt - b.scheduledAt).slice(0, limit);
  },
});
