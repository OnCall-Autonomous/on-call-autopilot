# Architecture

## Trust boundaries
1. Control plane: Convex state, orchestration, agent calls, policy and tool gateway.
2. Guarded service: separate repository and Cloudflare deployment; treated as untrusted/external.
3. Providers: GitHub, Cloudflare, Telegram, ElevenLabs, Linkup. Credentials are backend-only.
4. Model boundary: receives least-privilege evidence and returns schema-validated proposals, never direct credentials.

## Execution
An intake mutation creates an idempotent incident and DETECTED event. Commander determines severity and effective mode, then schedules scoped runs. Each run persists parent-child lineage, model/token/cost/duration, and summarized redacted I/O. Diagnoser is read-only. Policy Guard reviews diagnosis and proposed patch. Fixer may use narrow write tools only when effective mode permits. Deployment is polled deterministically. Verifier reconstructs and replays the original failing HTTP request independently. Performance measurement follows only after verification. Reporter is spawned only after both gates pass.

## Failure behavior
Timeouts, budgets, deadlines, and two-attempt counters are stored on the incident so retries survive process restarts. Verification failure retries at most twice, then rolls back or escalates. Provider uncertainty may spawn one temporary specialist. No code path can directly write RESOLVED without querying persisted verification and performance rows.

## Tool gateway contract
Every gateway method accepts incident/run IDs and an idempotency key; validates project allowlists; reads secrets internally; applies timeout/retry limits; redacts response metadata; emits start/end events; and returns a typed result. LLM agents cannot invoke arbitrary shell, git, HTTP, or Cloudflare operations.
