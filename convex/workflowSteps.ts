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

    return await ctx.db.insert("workflowSteps", {
      incidentId: args.incidentId,
      runId: args.runId,
      type: args.type,
      status: "scheduled",
      attempt: 1,
      idempotencyKey: args.idempotencyKey,
      inputSummary: args.inputSummary,
      scheduledAt: Date.now(),
      timeoutMs: args.timeoutMs,
    });
  },
});

export const start = internalMutation({
  args: { stepId: v.id("workflowSteps") },
  handler: async (ctx, args) => {
    const step = await ctx.db.get("workflowSteps", args.stepId);
    if (!step) throw new Error("WORKFLOW_STEP_NOT_FOUND");
    if (step.status === "running") return step._id;
    if (step.status !== "scheduled") throw new Error("WORKFLOW_STEP_NOT_STARTABLE");
    await ctx.db.patch("workflowSteps", step._id, { status: "running", startedAt: Date.now() });
    return step._id;
  },
});

export const succeed = internalMutation({
  args: { stepId: v.id("workflowSteps"), outputSummary: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const step = await ctx.db.get("workflowSteps", args.stepId);
    if (!step) throw new Error("WORKFLOW_STEP_NOT_FOUND");
    if (step.status !== "running") throw new Error("WORKFLOW_STEP_NOT_RUNNING");
    await ctx.db.patch("workflowSteps", step._id, {
      status: "succeeded",
      outputSummary: args.outputSummary,
      finishedAt: Date.now(),
    });
    return step._id;
  },
});

export const fail = internalMutation({
  args: {
    stepId: v.id("workflowSteps"),
    errorCode: v.string(),
    outputSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db.get("workflowSteps", args.stepId);
    if (!step) throw new Error("WORKFLOW_STEP_NOT_FOUND");
    if (step.status !== "running") throw new Error("WORKFLOW_STEP_NOT_RUNNING");
    await ctx.db.patch("workflowSteps", step._id, {
      status: "failed",
      errorCode: args.errorCode,
      outputSummary: args.outputSummary,
      finishedAt: Date.now(),
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
