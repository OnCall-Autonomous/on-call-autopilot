# Model and Agent Orchestration

## Agent/model policy
Model names are configuration, not business logic. Use a stronger reasoning model for Commander/Diagnoser/Fixer; a cheaper structured model for Reporter; no model for HTTP assertions or latency math. Record provider, model, prompt version, token count, cost, and latency on every model run.

## Handoffs
Commander passes Diagnoser: incident snapshot, bounded log window, recent deploys/commits, runbook candidates, repository read tools, deadline/budget. Diagnoser returns the Zod `diagnosisOutput` with at least two evidence records. Commander rejects malformed/weak output and may retry once.

Fixer receives only accepted diagnosis, effective mode, allowed repo/paths, line/file limits, relevant file contents, and required regression-test contract. It returns `patchOutput`; Policy Guard validates before any write. In PR Approval, branch/commit/draft PR may be created, but deployment waits for approval.

Verifier receives original failing request and deployment URL/ID, not Fixer's narrative. It executes status/schema/error-signature assertions and fresh-log checks through deterministic services. Performance receives verified endpoint, baseline, tolerance, sample count, and warmup policy. Reporter receives persisted facts only and cannot change incident state.

## Dynamic organization
Spawn `TEMP_SPECIALIST` only after first unknown diagnosis with no known signature, and give it provider/runtime-specific read/research tools. Spawn Reporter only after successful gates. Persist all parent-child edges in `agentRuns`.

## Investigate-only tracer configuration

The Diagnoser uses the single enabled `DIAGNOSER` LLM profile plus server-side `DIAGNOSER_API_KEY` and `DIAGNOSER_BASE_URL`. Convex 1.25.4 installed here does not export the newer typed `defineApp`/`env` API described by guidelines targeting Convex 1.41, so these values use the supported server-side `process.env` mechanism; credentials are never persisted or logged.

The request contains bounded incident facts from this database: service, severity, effective mode, current status, project identity/repository, up to 20 current incident events, and up to 20 recent project log signals. It instructs the model not to invent evidence and to state insufficiency truthfully. Provider/envelope/parser failures are exposed only as stable allowlisted categories; raw bodies, URLs, secrets, and stack messages are not written to the polling aggregate.

The tracer is strictly read/investigate-only: its only writes are orchestration lifecycle records, structured diagnosis/evidence, usage metadata when supplied, and the final human escalation. It creates no patch, PR, deployment, verification, performance, approval, repair, or external-write records.

## Durable scheduling
Use Convex actions for external calls and internal mutations for state writes. Schedule each next step rather than holding one long request open. Every scheduled step checks current status, idempotency key, deadline, budget, and attempt count before work, making duplicate delivery safe.
