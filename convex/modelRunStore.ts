import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const modelErrorCode = v.union(
  v.literal("MODEL_CONFIGURATION_ERROR"), v.literal("MODEL_TIMEOUT"), v.literal("MODEL_RATE_LIMITED"),
  v.literal("MODEL_AUTHENTICATION_FAILED"), v.literal("MODEL_PROVIDER_ERROR"), v.literal("MODEL_RESPONSE_INVALID"),
);

function requireRunning(run: { status: string }) {
  if (run.status !== "running") throw new Error("AGENT_RUN_NOT_RUNNING");
}

export const load = internalQuery({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("agentRuns", args.runId);
    if (!run) throw new Error("AGENT_RUN_NOT_FOUND");
    if (run.agent !== "COMMANDER" && run.agent !== "DIAGNOSER") throw new Error("MODEL_AGENT_NOT_READ_ONLY");
    const incident = await ctx.db.get("incidents", run.incidentId);
    if (!incident) throw new Error("INCIDENT_NOT_FOUND");
    const profile = await ctx.db.query("modelProfiles").withIndex("by_agent", (q) => q.eq("agent", run.agent)).unique();
    if (!profile?.enabled || profile.kind !== "llm" || profile.provider !== "openai" || !profile.model) {
      throw new Error("MODEL_PROFILE_NOT_CONFIGURED");
    }
    return { run, incident, profile };
  },
});

export const succeed = internalMutation({
  args: {
    runId: v.id("agentRuns"), provider: v.string(), model: v.string(), promptVersion: v.string(),
    inputSummary: v.string(), outputSummary: v.string(), tokens: v.number(), cost: v.number(), latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("agentRuns", args.runId);
    if (!run) throw new Error("AGENT_RUN_NOT_FOUND");
    requireRunning(run);
    const finishedAt = Date.now();
    await ctx.db.patch("agentRuns", run._id, {
      status: "succeeded", provider: args.provider, model: args.model, promptVersion: args.promptVersion,
      inputSummary: args.inputSummary, outputSummary: args.outputSummary, tokens: args.tokens, cost: args.cost,
      durationMs: args.latencyMs, startedAt: run.startedAt ?? finishedAt - args.latencyMs, finishedAt,
    });
    await ctx.db.insert("events", {
      incidentId: run.incidentId, runId: run._id, type: "MODEL_RUN", status: "succeeded", timestamp: finishedAt,
      metadata: { provider: args.provider, model: args.model, promptVersion: args.promptVersion, tokens: args.tokens, cost: args.cost, latencyMs: args.latencyMs },
    });
    return true;
  },
});

export const fail = internalMutation({
  args: { runId: v.id("agentRuns"), errorCode: modelErrorCode, outputSummary: v.string(), latencyMs: v.number() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("agentRuns", args.runId);
    if (!run) throw new Error("AGENT_RUN_NOT_FOUND");
    requireRunning(run);
    const finishedAt = Date.now();
    await ctx.db.patch("agentRuns", run._id, {
      status: "failed", errorCode: args.errorCode, outputSummary: args.outputSummary,
      durationMs: args.latencyMs, startedAt: run.startedAt ?? finishedAt - args.latencyMs, finishedAt,
    });
    await ctx.db.insert("events", {
      incidentId: run.incidentId, runId: run._id, type: "MODEL_RUN", status: "failed", timestamp: finishedAt,
      metadata: { provider: run.provider ?? "openai", model: run.model, promptVersion: run.promptVersion, latencyMs: args.latencyMs, errorCode: args.errorCode },
    });
    return true;
  },
});
