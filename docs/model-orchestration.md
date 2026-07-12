# Model and Agent Orchestration

## Agent/model policy
Model names are configuration, not business logic. Use a stronger reasoning model for Commander/Diagnoser/Fixer; a cheaper structured model for Reporter; no model for HTTP assertions or latency math. Record provider, model, prompt version, token count, cost, and latency on every model run.

## Handoffs
Commander passes Diagnoser: incident snapshot, bounded log window, recent deploys/commits, runbook candidates, repository read tools, deadline/budget. Diagnoser returns the Zod `diagnosisOutput` with at least two evidence records. Commander rejects malformed/weak output and may retry once.

Fixer receives only accepted diagnosis, effective mode, allowed repo/paths, line/file limits, relevant file contents, and required regression-test contract. It returns `patchOutput`; Policy Guard validates before any write. In PR Approval, branch/commit/draft PR may be created, but deployment waits for approval.

Verifier receives original failing request and deployment URL/ID, not Fixer's narrative. It executes status/schema/error-signature assertions and fresh-log checks through deterministic services. Performance receives verified endpoint, baseline, tolerance, sample count, and warmup policy. Reporter receives persisted facts only and cannot change incident state.

## Dynamic organization
Spawn `TEMP_SPECIALIST` only after first unknown diagnosis with no known signature, and give it provider/runtime-specific read/research tools. Spawn Reporter only after successful gates. Persist all parent-child edges in `agentRuns`.

## Durable scheduling
Use Convex actions for external calls and internal mutations for state writes. Schedule each next step rather than holding one long request open. Every scheduled step checks current status, idempotency key, deadline, budget, and attempt count before work, making duplicate delivery safe.
