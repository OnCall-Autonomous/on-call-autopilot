import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const agentName = v.union(
  v.literal("COMMANDER"),
  v.literal("DIAGNOSER"),
  v.literal("FIXER"),
  v.literal("VERIFIER"),
  v.literal("PERFORMANCE"),
  v.literal("REPORTER"),
  v.literal("TEMP_SPECIALIST"),
);

export const enqueue = internalMutation({
  args: {
    incidentId: v.id("incidents"),
    parentRunId: v.optional(v.id("agentRuns")),
    agent: agentName,
    idempotencyKey: v.string(),
    inputSummary: v.string(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    promptVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentRuns")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();
    if (existing) return existing._id;

    const incident = await ctx.db.get("incidents", args.incidentId);
    if (!incident) throw new Error("INCIDENT_NOT_FOUND");
    if (args.parentRunId) {
      const parent = await ctx.db.get("agentRuns", args.parentRunId);
      if (!parent || parent.incidentId !== args.incidentId) throw new Error("INVALID_PARENT_AGENT_RUN");
    }

    const queuedAt = Date.now();
    const runId = await ctx.db.insert("agentRuns", {
      incidentId: args.incidentId,
      parentRunId: args.parentRunId,
      agent: args.agent,
      status: "queued",
      idempotencyKey: args.idempotencyKey,
      inputSummary: args.inputSummary,
      provider: args.provider,
      model: args.model,
      promptVersion: args.promptVersion,
      queuedAt,
    });
    await ctx.db.insert("events", {
      incidentId: args.incidentId,
      runId,
      type: "AGENT_RUN",
      status: "queued",
      timestamp: queuedAt,
      metadata: {
        agent: args.agent,
        parentRunId: args.parentRunId,
        provider: args.provider,
        model: args.model,
        promptVersion: args.promptVersion,
        idempotencyKey: args.idempotencyKey,
      },
    });
    return runId;
  },
});

export const start = internalMutation({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("agentRuns", args.runId);
    if (!run) throw new Error("AGENT_RUN_NOT_FOUND");
    if (run.status === "running") return run._id;
    if (run.status !== "queued") throw new Error("AGENT_RUN_NOT_STARTABLE");
    const startedAt = Date.now();
    await ctx.db.patch("agentRuns", run._id, { status: "running", startedAt });
    await ctx.db.insert("events", {
      incidentId: run.incidentId,
      runId: run._id,
      type: "AGENT_RUN",
      status: "running",
      timestamp: startedAt,
      metadata: { agent: run.agent, parentRunId: run.parentRunId, promptVersion: run.promptVersion },
    });
    return run._id;
  },
});

export const succeed = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    outputSummary: v.string(),
    tokens: v.optional(v.number()),
    cost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("agentRuns", args.runId);
    if (!run) throw new Error("AGENT_RUN_NOT_FOUND");
    if (run.status !== "running" || run.startedAt === undefined) throw new Error("AGENT_RUN_NOT_RUNNING");
    const finishedAt = Date.now();
    const durationMs = finishedAt - run.startedAt;
    await ctx.db.patch("agentRuns", run._id, {
      status: "succeeded",
      outputSummary: args.outputSummary,
      tokens: args.tokens,
      cost: args.cost,
      durationMs,
      finishedAt,
    });
    await ctx.db.insert("events", {
      incidentId: run.incidentId,
      runId: run._id,
      type: "AGENT_RUN",
      status: "succeeded",
      timestamp: finishedAt,
      metadata: { agent: run.agent, durationMs, tokens: args.tokens, cost: args.cost },
    });
    return run._id;
  },
});

export const fail = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    errorCode: v.string(),
    outputSummary: v.string(),
    tokens: v.optional(v.number()),
    cost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("agentRuns", args.runId);
    if (!run) throw new Error("AGENT_RUN_NOT_FOUND");
    if (run.status !== "running" || run.startedAt === undefined) throw new Error("AGENT_RUN_NOT_RUNNING");
    const finishedAt = Date.now();
    const durationMs = finishedAt - run.startedAt;
    await ctx.db.patch("agentRuns", run._id, {
      status: "failed",
      errorCode: args.errorCode,
      outputSummary: args.outputSummary,
      tokens: args.tokens,
      cost: args.cost,
      durationMs,
      finishedAt,
    });
    await ctx.db.insert("events", {
      incidentId: run.incidentId,
      runId: run._id,
      type: "AGENT_RUN",
      status: "failed",
      timestamp: finishedAt,
      metadata: { agent: run.agent, durationMs, tokens: args.tokens, cost: args.cost, errorCode: args.errorCode },
    });
    return run._id;
  },
});

export const reject = internalMutation({
  args: { runId: v.id("agentRuns"), rejectionReason: v.string(), outputSummary: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("agentRuns", args.runId);
    if (!run) throw new Error("AGENT_RUN_NOT_FOUND");
    if (run.status !== "running" || run.startedAt === undefined) throw new Error("AGENT_RUN_NOT_RUNNING");
    const finishedAt = Date.now();
    const durationMs = finishedAt - run.startedAt;
    await ctx.db.patch("agentRuns", run._id, {
      status: "rejected",
      rejectionReason: args.rejectionReason,
      outputSummary: args.outputSummary,
      durationMs,
      finishedAt,
    });
    await ctx.db.insert("events", {
      incidentId: run.incidentId,
      runId: run._id,
      type: "AGENT_RUN",
      status: "rejected",
      timestamp: finishedAt,
      metadata: { agent: run.agent, durationMs, rejectionReason: args.rejectionReason },
    });
    return run._id;
  },
});

export const listByIncident = query({
  args: { incidentId: v.id("incidents"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    return await ctx.db
      .query("agentRuns")
      .withIndex("by_incidentId_and_queuedAt", (q) => q.eq("incidentId", args.incidentId))
      .order("asc")
      .take(limit);
  },
});

export const active = query({
  args: { incidentId: v.id("incidents"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 100);
    return await ctx.db
      .query("agentRuns")
      .withIndex("by_incidentId_and_status_and_queuedAt", (q) =>
        q.eq("incidentId", args.incidentId).eq("status", "running"),
      )
      .order("asc")
      .take(limit);
  },
});
