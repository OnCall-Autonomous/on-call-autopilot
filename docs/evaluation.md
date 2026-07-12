# Evaluation Plan

## Layers
1. Unit invariants: transitions, mode ceilings, path/line/file policy, resolution gates, structured outputs.
2. Scenario evals: eight named PRD cases in `src/evals/cases.ts`, run against each prompt/agent version.
3. Integration contract tests: recorded provider fixtures, explicit and labeled; test retries, redaction, idempotency, polling.
4. Live acceptance: external broken app -> diagnosis -> guarded patch -> deploy -> exact HTTP verification -> performance -> PR, repeated three times.

## Scoring
A case passes only when expected root-cause class, mode, tool permissions, changed files, assertions, terminal state, cost, and deadline all pass. LLM text similarity alone is insufficient. Any golden-invariant breach is a hard failure and blocks release.

## Golden invariants
No resolution without passing independent verification; no resolution with unwaived regression; no writes outside allowlist; no autonomous migration/dependency/secret changes; low confidence cannot patch; Investigate Only writes nothing; failed live incidents become regression cases.

## Live evidence packet
For each of three runs preserve incident ID, trace tree, diagnosis evidence, diff, commit/PR URL, Cloudflare deployment ID/URL, exact before/after response, fresh-log check, latency samples/percentiles, cost/duration, and terminal state. A fixture cannot satisfy live acceptance.
