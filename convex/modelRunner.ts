import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { createOpenAIClient, ModelClientError, readOnlyAgent, type ModelResult } from "../src/models/openai-client";

type ModelContext = { run: Doc<"agentRuns">; incident: Doc<"incidents">; profile: Doc<"modelProfiles"> };

export const execute = internalAction({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args): Promise<unknown> => {
    const startedAt = Date.now();
    try {
      await ctx.runMutation(internal.agentRuns.start, { runId: args.runId });
      const context: ModelContext = await ctx.runQuery(internal.modelRunStore.load, { runId: args.runId });
      const agent = readOnlyAgent.parse(context.run.agent);
      const client = createOpenAIClient({ apiKey: process.env.OPENAI_API_KEY ?? "" });
      const result: ModelResult<unknown> = await client.generate({
        agent,
        model: context.profile.model!,
        promptVersion: context.profile.promptVersion,
        temperature: context.profile.temperature,
        maxTokens: context.profile.maxTokens,
        input: {
          incident: {
            service: context.incident.service, severity: context.incident.severity,
            configuredMode: context.incident.configuredMode, effectiveMode: context.incident.effectiveMode,
            status: context.incident.status, attempts: context.incident.attempts,
          },
          task: context.run.inputSummary,
        },
      });
      await ctx.runMutation(internal.modelRunStore.succeed, {
        runId: args.runId, provider: result.provider, model: result.model, promptVersion: result.promptVersion,
        inputSummary: result.inputSummary, outputSummary: result.outputSummary, tokens: result.tokens,
        cost: result.cost, latencyMs: result.latencyMs,
      });
      return result.output;
    } catch (error) {
      const code = error instanceof ModelClientError ? error.code : "MODEL_PROVIDER_ERROR";
      await ctx.runMutation(internal.modelRunStore.fail, {
        runId: args.runId, errorCode: code,
        outputSummary: error instanceof Error ? error.message : "Model execution failed",
        latencyMs: Date.now() - startedAt,
      });
      return null;
    }
  },
});
