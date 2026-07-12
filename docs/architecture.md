# Architecture

## Trust boundaries
1. Control plane: Convex state, orchestration, agent calls, policy and tool gateway.
2. Guarded service: separate repository and Cloudflare deployment; treated as untrusted/external.
3. Providers: GitHub, Cloudflare, Telegram, ElevenLabs, Linkup. Credentials are backend-only.
4. Model boundary: receives least-privilege evidence and returns schema-validated proposals, never direct credentials.

## Execution
An intake mutation creates an idempotent incident and DETECTED event. Commander determines severity and effective mode, then schedules scoped runs. Each run persists parent-child lineage, model/token/cost/duration, and summarized redacted I/O. Diagnoser is read-only. Policy Guard reviews diagnosis and proposed patch. Fixer may use narrow write tools only when effective mode permits. Deployment is polled deterministically. Verifier reconstructs and replays the original failing HTTP request independently. Performance measurement follows only after verification. Reporter is spawned only after both gates pass.

## GitHub diagnosis and PR delivery
Investigate Only can gather real evidence without writing: fetch public issue and CI metadata, read and search allowlisted repository paths, create an isolated checkout, and run one bounded package-manager reproduction command. Every command is argument-array based, time/output bounded, and repository/path/ref validated.

An accepted diagnosis may then follow `DIAGNOSIS_REVIEW → PATCHING → PATCH_REVIEW → PR_READY`. The GitHub gateway creates a feature branch, applies a supplied patch through stdin, inspects the resulting diff, rejects protected or non-allowlisted paths, enforces changed-file/line limits, requires a changed regression test, runs targeted and full tests, commits, pushes, opens a PR, and verifies both the remote SHA and PR URL/head SHA. It has no merge or deployment operation; automation stops at `PR_READY` and waits for human approval.

## Failure behavior
Timeouts, budgets, deadlines, and two-attempt counters are stored on the incident so retries survive process restarts. Verification failure retries at most twice, then rolls back or escalates. Provider uncertainty may spawn one temporary specialist. No code path can directly write RESOLVED without querying persisted verification and performance rows.

## Tool gateway contract
Every gateway method accepts incident/run IDs and an idempotency key; validates project allowlists; reads secrets internally; applies timeout/retry limits; redacts response metadata; emits start/end events; and returns a typed result. LLM agents cannot invoke arbitrary shell, git, HTTP, or Cloudflare operations.
