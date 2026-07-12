import { v } from "convex/values";
import { mutation } from "./_generated/server";

const LEASE_MS = 120_000;

function authorize(token: string) {
  const expected = process.env.AGENT_WORKER_TOKEN;
  if (!expected || token !== expected) throw new Error("UNAUTHORIZED_WORKER");
}

export const claimNext = mutation({
  args: { token: v.string(), workerId: v.string() },
  handler: async (ctx, args) => {
    authorize(args.token);
    const run = await ctx.db
      .query("agentRuns")
      .withIndex("by_status_and_queuedAt", (q) => q.eq("status", "queued"))
      .order("asc")
      .first();
    if (!run) return null;
    const startedAt = Date.now();
    const leaseExpiresAt = startedAt + LEASE_MS;
    await ctx.db.patch("agentRuns", run._id, {
      status: "running", workerId: args.workerId, startedAt, heartbeatAt: startedAt, leaseExpiresAt,
    });
    await ctx.db.insert("events", {
      incidentId: run.incidentId, runId: run._id, type: "AGENT_RUN", status: "running", timestamp: startedAt,
      metadata: { agent: run.agent, workerId: args.workerId, leaseExpiresAt },
    });
    return { ...run, status: "running" as const, workerId: args.workerId, startedAt, heartbeatAt: startedAt, leaseExpiresAt };
  },
});

export const heartbeat = mutation({
  args: { token: v.string(), workerId: v.string(), runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    authorize(args.token);
    const run = await ctx.db.get("agentRuns", args.runId);
    if (!run || run.status !== "running" || run.workerId !== args.workerId) throw new Error("WORKER_LEASE_NOT_OWNED");
    const heartbeatAt = Date.now();
    await ctx.db.patch("agentRuns", run._id, { heartbeatAt, leaseExpiresAt: heartbeatAt + LEASE_MS });
    return true;
  },
});

export const complete = mutation({
  args: {
    token: v.string(), workerId: v.string(), runId: v.id("agentRuns"),
    outputSummary: v.string(), durationMs: v.number(), tokens: v.optional(v.number()), cost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    authorize(args.token);
    const run = await ctx.db.get("agentRuns", args.runId);
    if (!run || run.status !== "running" || run.workerId !== args.workerId) throw new Error("WORKER_LEASE_NOT_OWNED");
    const finishedAt = Date.now();
    await ctx.db.patch("agentRuns", run._id, {
      status: "succeeded", outputSummary: args.outputSummary.slice(0, 8_000), durationMs: args.durationMs,
      tokens: args.tokens, cost: args.cost, finishedAt, leaseExpiresAt: undefined,
    });
    await ctx.db.insert("events", {
      incidentId: run.incidentId, runId: run._id, type: "AGENT_RUN", status: "succeeded", timestamp: finishedAt,
      metadata: { agent: run.agent, workerId: args.workerId, durationMs: args.durationMs, tokens: args.tokens, cost: args.cost },
    });
    return true;
  },
});

export const fail = mutation({
  args: {
    token: v.string(), workerId: v.string(), runId: v.id("agentRuns"), errorCode: v.string(),
    outputSummary: v.string(), durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    authorize(args.token);
    const run = await ctx.db.get("agentRuns", args.runId);
    if (!run || run.status !== "running" || run.workerId !== args.workerId) throw new Error("WORKER_LEASE_NOT_OWNED");
    const finishedAt = Date.now();
    await ctx.db.patch("agentRuns", run._id, {
      status: "failed", errorCode: args.errorCode, outputSummary: args.outputSummary.slice(0, 8_000),
      durationMs: args.durationMs, finishedAt, leaseExpiresAt: undefined,
    });
    await ctx.db.insert("events", {
      incidentId: run.incidentId, runId: run._id, type: "AGENT_RUN", status: "failed", timestamp: finishedAt,
      metadata: { agent: run.agent, workerId: args.workerId, durationMs: args.durationMs, errorCode: args.errorCode },
    });
    return true;
  },
});
