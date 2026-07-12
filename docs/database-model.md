# Convex Database Model

`convex/schema.ts` is the executable source of truth.

## Ownership and retention
- `projects`: static guarded-service configuration and guardrails. Never store API tokens.
- `incidents`: durable workflow aggregate, autonomy modes, attempt counters, budget/deadline, and terminal outcome.
- `agentRuns`: trace tree nodes. `parentRunId` models Commander-to-specialist delegation.
- `events`: append-only audit/timeline records; metadata must be redacted and size-bounded.
- `deployments`: external deployment proof and preview/production URLs.
- `verifications`: exact request, deterministic assertion output, fresh-log verdict. Immutable after insert.
- `performance`: baseline/post-fix percentiles, success rate, sample count, and waiver/pass/regression verdict.
- `runbooks`: created only from resolved incidents; matches are hypotheses and never bypass current evidence.
- `approvals`: explicit deploy decision for PR Approval mode.
- `evalCases`/`evalRuns`: versioned test definitions and prompt/agent-version results.
- `logs`: shared ingress written by guarded app and read by Autopilot; index by project/time.

## Required indexes
Incident idempotency, project/status, event incident/time, log project/time, runs/deployments/verification/performance by incident, runbooks by project/signature, and eval runs by case/time.

## Data invariants
RESOLVED requires latest persisted verification `passed=true` and `freshLogsClean=true`, plus latest performance verdict PASS or explicit WAIVED. A waiver must later include actor/reason fields before production launch. Runbook creation references a resolved incident. Approval must match the incident and remain single-use. Events are append-only; corrections are new events. Embeddings contain no secrets or raw request bodies.
