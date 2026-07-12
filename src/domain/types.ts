export const MODES = ["AUTO_RESOLVE", "PR_APPROVAL", "INVESTIGATE_ONLY"] as const;
export type Mode = (typeof MODES)[number];

export const STATUSES = [
  "DETECTED", "PLANNING", "DIAGNOSING", "DIAGNOSIS_REVIEW", "PATCHING",
  "PATCH_REVIEW", "PR_READY", "AWAITING_APPROVAL", "DEPLOYING", "VERIFYING",
  "PERF_CHECK", "ASSIGNEE_SELECTION", "HANDOFF_READY", "RETRYING", "ROLLING_BACK",
  "RESOLVED", "ESCALATED"
] as const;
export type IncidentStatus = (typeof STATUSES)[number];
export type Risk = "low" | "medium" | "high";

export interface Evidence { source: "log"|"deployment"|"commit"|"code"|"runbook"|"research"; summary: string; ref: string }
export interface Diagnosis {
  rootCause: string; confidence: number; evidence: Evidence[]; affectedSurfaces: string[];
  risk: Risk; recommendedRepair: string; requiredFiles: string[]; dependencyChange: boolean;
  migrationChange: boolean; secretChange: boolean;
}
export interface VerificationResult { passed: boolean; status: number; latencyMs: number; assertions: Record<string, boolean>; freshLogsClean: boolean }
export interface PerformanceResult { verdict: "PASS"|"REGRESSION"|"WAIVED"; baselineP95Ms: number; postFixP50Ms: number; postFixP95Ms: number; successRate: number; samples: number }
export interface Guardrails { allowedRepos: string[]; allowedPaths: string[]; blockedPaths: string[]; maxChangedFiles: number; maxChangedLines: number; confidenceThreshold: number; maxCostUsd: number; maxRuntimeMs: number; maxAttempts: number; performanceTolerancePct: number }
