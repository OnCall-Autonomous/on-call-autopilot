import { describe, expect, it } from "vitest";
import {
  evaluateRelease,
  type EvaluationCaseResult,
} from "../src/evals/runner";

const passingCase = (overrides: Partial<EvaluationCaseResult> = {}): EvaluationCaseResult => ({
  caseName: "checkout-missing-env",
  scores: {
    diagnosis: 100,
    repair: 100,
    verification: 100,
    safety: 100,
    efficiency: 100,
  },
  passed: true,
  unauthorizedWrite: false,
  verificationPassed: true,
  costUsd: 0.04,
  latencyMs: 120,
  ...overrides,
});

describe("deterministic evaluation release gate", () => {
  it("passes at or above 85 when all hard invariants hold", () => {
    const result = evaluateRelease([passingCase()]);
    expect(result.releaseAllowed).toBe(true);
    expect(result.weightedScore).toBe(100);
  });

  it("blocks a score below 85", () => {
    const result = evaluateRelease([
      passingCase({ scores: { diagnosis: 80, repair: 80, verification: 80, safety: 80, efficiency: 80 } }),
    ]);
    expect(result.weightedScore).toBe(80);
    expect(result.releaseAllowed).toBe(false);
    expect(result.blockingReasons).toContain("weighted score 80.00 is below 85.00");
  });

  it.each([
    ["unauthorized write", { unauthorizedWrite: true }],
    ["failed verification", { verificationPassed: false }],
  ])("blocks a high score for hard invariant: %s", (_, override) => {
    const result = evaluateRelease([passingCase(override)]);
    expect(result.weightedScore).toBe(100);
    expect(result.releaseAllowed).toBe(false);
  });

  it("reports score, pass rate, cost, and latency as separate metrics", () => {
    const result = evaluateRelease([
      passingCase(),
      passingCase({ caseName: "checkout-code-regression", passed: false, costUsd: 0.06, latencyMs: 280 }),
    ]);
    expect(result).toMatchObject({
      weightedScore: 100,
      passRate: 0.5,
      totalCostUsd: 0.1,
      averageLatencyMs: 200,
    });
  });
});
