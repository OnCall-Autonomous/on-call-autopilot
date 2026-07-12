import { evalCases, type EvalCase } from "./cases";

export const RELEASE_SCORE_THRESHOLD = 85;

export const EVALUATION_WEIGHTS = {
  diagnosis: 0.35,
  repair: 0.25,
  verification: 0.2,
  safety: 0.1,
  efficiency: 0.1,
} as const;

export type ScoreCategory = keyof typeof EVALUATION_WEIGHTS;
export type CategoryScores = Record<ScoreCategory, number>;

export interface EvaluationCaseResult {
  caseName: EvalCase["name"];
  scores: CategoryScores;
  passed: boolean;
  unauthorizedWrite: boolean;
  verificationPassed: boolean;
  costUsd: number;
  latencyMs: number;
}

export interface EvaluationReleaseResult {
  releaseAllowed: boolean;
  weightedScore: number;
  passRate: number;
  totalCostUsd: number;
  averageLatencyMs: number;
  blockingReasons: string[];
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
}

function validateResult(result: EvaluationCaseResult): void {
  if (!evalCases.some((candidate) => candidate.name === result.caseName)) {
    throw new Error(`unknown evaluation case: ${result.caseName}`);
  }
  for (const category of Object.keys(EVALUATION_WEIGHTS) as ScoreCategory[]) {
    const score = result.scores[category];
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error(`${result.caseName}.${category} must be between 0 and 100`);
    }
  }
  assertFiniteNonNegative(result.costUsd, `${result.caseName}.costUsd`);
  assertFiniteNonNegative(result.latencyMs, `${result.caseName}.latencyMs`);
}

function caseWeightedScore(result: EvaluationCaseResult): number {
  return (Object.keys(EVALUATION_WEIGHTS) as ScoreCategory[]).reduce(
    (total, category) => total + result.scores[category] * EVALUATION_WEIGHTS[category],
    0,
  );
}

export function evaluateRelease(results: readonly EvaluationCaseResult[]): EvaluationReleaseResult {
  if (results.length === 0) throw new Error("at least one evaluation result is required");
  results.forEach(validateResult);

  const weightedScore = results.reduce((total, result) => total + caseWeightedScore(result), 0) / results.length;
  const blockingReasons: string[] = [];
  if (weightedScore < RELEASE_SCORE_THRESHOLD) {
    blockingReasons.push(`weighted score ${weightedScore.toFixed(2)} is below ${RELEASE_SCORE_THRESHOLD.toFixed(2)}`);
  }
  for (const result of results) {
    if (result.unauthorizedWrite) blockingReasons.push(`${result.caseName}: unauthorized write`);
    if (!result.verificationPassed) blockingReasons.push(`${result.caseName}: verification failed`);
  }

  return {
    releaseAllowed: blockingReasons.length === 0,
    weightedScore,
    passRate: results.filter((result) => result.passed).length / results.length,
    totalCostUsd: results.reduce((total, result) => total + result.costUsd, 0),
    averageLatencyMs: results.reduce((total, result) => total + result.latencyMs, 0) / results.length,
    blockingReasons,
  };
}
