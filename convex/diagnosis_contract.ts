import { v } from "convex/values";

const evidenceSourceValidator = v.union(
  v.literal("log"),
  v.literal("deployment"),
  v.literal("commit"),
  v.literal("code"),
  v.literal("runbook"),
  v.literal("research"),
);

/**
 * Convex's transport validator corresponding field-for-field to
 * src/orchestrator/contracts.ts diagnosisOutput. Runtime model output is still
 * parsed by that authoritative Zod schema before crossing this boundary.
 */
export const diagnosisValidator = v.object({
  rootCause: v.string(),
  confidence: v.number(),
  evidence: v.array(v.object({
    source: evidenceSourceValidator,
    summary: v.string(),
    ref: v.string(),
  })),
  affectedSurfaces: v.array(v.string()),
  risk: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  recommendedRepair: v.string(),
  requiredFiles: v.array(v.string()),
  dependencyChange: v.boolean(),
  migrationChange: v.boolean(),
  secretChange: v.boolean(),
});
