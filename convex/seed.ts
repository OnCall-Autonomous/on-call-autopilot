import { mutation } from "./_generated/server";
import { DEFAULT_MODEL_PROFILES } from "../src/models/model-profiles";
import { evalCases } from "../src/evals/cases";

export const defaults = mutation({
  args: {},
  handler: async (ctx) => {
    let modelsCreated = 0;
    for (const profile of DEFAULT_MODEL_PROFILES) {
      const existing = await ctx.db.query("modelProfiles").withIndex("by_agent", (q) => q.eq("agent", profile.agent)).unique();
      if (!existing) {
        await ctx.db.insert("modelProfiles", { ...profile, updatedAt: Date.now() });
        modelsCreated += 1;
      }
    }
    let evalsCreated = 0;
    for (const item of evalCases) {
      const existing = await ctx.db.query("evalCases").withIndex("by_name", (q) => q.eq("name", item.name)).unique();
      if (!existing) {
        await ctx.db.insert("evalCases", {
          name: item.name,
          failureMode: item.failureMode,
          expectedCause: item.expected,
          allowedFiles: [],
          expectedAssertions: [item.invariant],
          status: "ACTIVE",
          createdAt: Date.now(),
        });
        evalsCreated += 1;
      }
    }
    return { modelsCreated, evalsCreated };
  },
});
