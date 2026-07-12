import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const source = v.union(v.literal("langfuse"), v.literal("local"), v.literal("fallback"));
const kind = v.union(
  v.literal("trace"),
  v.literal("span"),
  v.literal("generation"),
  v.literal("tool"),
  v.literal("agent"),
  v.literal("guardrail"),
  v.literal("event"),
  v.literal("fallback"),
);
const status = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("skipped"),
);

function clampLimit(value: number | undefined, fallback: number) {
  return Math.min(Math.max(Math.floor(value ?? fallback), 1), 100);
}

export const record = mutation({
  args: {
    incidentId: v.id("incidents"),
    runId: v.optional(v.id("agentRuns")),
    source,
    kind,
    name: v.string(),
    status,
    idempotencyKey: v.string(),
    traceId: v.optional(v.string()),
    observationId: v.optional(v.string()),
    traceUrl: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    inputSummary: v.optional(v.string()),
    outputSummary: v.optional(v.string()),
    tokens: v.optional(v.number()),
    cost: v.optional(v.number()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    fallbackFrom: v.optional(v.string()),
    fallbackTo: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const incident = await ctx.db.get(args.incidentId);
    if (!incident) throw new Error("INCIDENT_NOT_FOUND");

    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (!run || run.incidentId !== args.incidentId) throw new Error("INVALID_OBSERVABILITY_RUN");
    }

    const existing = await ctx.db
      .query("observabilityRecords")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();
    const finishedAt = args.finishedAt;
    const durationMs =
      args.durationMs ?? (finishedAt !== undefined ? Math.max(0, finishedAt - args.startedAt) : undefined);
    const record = {
      incidentId: args.incidentId,
      runId: args.runId,
      source: args.source,
      kind: args.kind,
      name: args.name.slice(0, 160),
      status: args.status,
      idempotencyKey: args.idempotencyKey,
      traceId: args.traceId,
      observationId: args.observationId,
      traceUrl: args.traceUrl,
      provider: args.provider,
      model: args.model,
      promptVersion: args.promptVersion,
      inputSummary: args.inputSummary?.slice(0, 1_000),
      outputSummary: args.outputSummary?.slice(0, 1_000),
      tokens: args.tokens,
      cost: args.cost,
      startedAt: args.startedAt,
      finishedAt,
      durationMs,
      fallbackFrom: args.fallbackFrom,
      fallbackTo: args.fallbackTo,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage?.slice(0, 1_000),
      metadata: args.metadata ?? {},
    };

    const statusChanged = !existing || existing.status !== args.status;
    const recordId = existing
      ? (await ctx.db.patch(existing._id, record), existing._id)
      : await ctx.db.insert("observabilityRecords", record);

    if (statusChanged) {
      await ctx.db.insert("events", {
        incidentId: args.incidentId,
        runId: args.runId,
        type: "OBSERVABILITY",
        status: args.status,
        timestamp: Date.now(),
        metadata: {
          recordId,
          source: args.source,
          kind: args.kind,
          name: args.name.slice(0, 160),
          traceId: args.traceId,
          observationId: args.observationId,
          provider: args.provider,
          model: args.model,
          fallbackFrom: args.fallbackFrom,
          fallbackTo: args.fallbackTo,
          errorCode: args.errorCode,
        },
      });
    }

    return recordId;
  },
});

export const listByIncident = query({
  args: { incidentId: v.id("incidents"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = clampLimit(args.limit, 50);
    return await ctx.db
      .query("observabilityRecords")
      .withIndex("by_incidentId_and_startedAt", (q) => q.eq("incidentId", args.incidentId))
      .order("desc")
      .take(limit);
  },
});

export const listByRun = query({
  args: { runId: v.id("agentRuns"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("AGENT_RUN_NOT_FOUND");
    const limit = clampLimit(args.limit, 20);
    return await ctx.db
      .query("observabilityRecords")
      .withIndex("by_runId_and_startedAt", (q) => q.eq("runId", args.runId))
      .order("desc")
      .take(limit);
  },
});
