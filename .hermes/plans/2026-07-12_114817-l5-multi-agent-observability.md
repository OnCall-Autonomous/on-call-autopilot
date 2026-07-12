# L5 Multi-Agent, Observability, and Distribution Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn the current Convex/API scaffold into a real L5 autonomous incident-response product with dynamic specialist organization, full trace observability, repeatable evaluation, and a measurable distribution funnel.

**Architecture:** Convex is the durable workflow/state/event backbone. A Commander action schedules bounded specialist runs; specialists only receive narrow typed tools; deterministic services enforce transitions, policy, deployment completion, HTTP assertions, performance, budgets, and closure. The UI consumes real-time Convex queries for the hero trace and HTTP endpoints for commands/integrations.

**Tech Stack:** TypeScript, Convex actions/mutations/queries/scheduler, Zod, OpenRouter/model API, GitHub API, Cloudflare API, native fetch HTTP verification, Vitest/convex-test, Next.js UI (separate or future package), Telegram, ElevenLabs, Linkup, PostHog/Plausible/DataFast.

---

## Current Baseline

Already implemented:
- Convex schema for projects, model profiles, incidents, agent runs, events, deployments, verification, performance, runbooks, approvals, evals, and logs.
- HTTP routes for projects, incidents, overview, incident detail, approvals, and model profiles.
- State-machine, resolution gates, policy guard, Zod output contracts, default model profiles, eval catalog, and seed mutation.
- UI integration specification and 15 passing unit/contract tests.

Important limitation: this is a scaffold, not yet a working recovery loop. No Commander currently invokes real models/tools, no external GitHub/Cloudflare adapters execute, no exact-request verifier runs, no performance sampler runs, and Convex deployment remains blocked pending setup/auth/download.

## L5 Definition for This Product

A judge must be able to see all of the following live:
1. Commander dynamically plans and delegates based on incident evidence rather than replaying a fixed script.
2. Diagnoser, Fixer, Verifier, Performance, and Reporter have distinct scopes and persisted parent-child handoffs.
3. An unknown provider/runtime issue causes a temporary specialist to be spawned with a visible reason.
4. Reporter is spawned only after independent verification and performance gates pass.
5. Weak specialist output is rejected/retried/escalated by Commander.
6. Every model and tool call is visible in one trace tree with input/output summaries, evidence, duration, tokens, cost, retries, and state transitions.
7. Three real external recoveries produce GitHub PR, Cloudflare deployment proof, exact HTTP pass, clean fresh logs, performance pass, and runbook.
8. A repeat incident visibly uses memory and resolves with fewer calls/lower MTTR.
9. The eight-case eval suite blocks any golden-invariant regression.
10. Distribution is proven using native social analytics, read-only product analytics, and meaningful-action records.

---

## Phase 0 — Convex Deployment and Generated Types (P0)

### Task 1: Link and deploy Convex

**Files:** generated `convex/_generated/*`, `.env.local` (never commit), `convex.json`.

1. Run `npx convex dev` interactively and authenticate/create the project.
2. Confirm real generated API/data-model files replace temporary shims.
3. Run `npm run seed` and inspect model/eval rows in Convex dashboard.
4. Run `npm run deploy` and record `.convex.cloud` and `.convex.site` URLs.
5. Run `npm run check` after generation.

**Completion:** health route responds from the deployed `.convex.site` URL and database seed rows are visible.

### Task 2: Add deployment-safe configuration validation

**Files:** create `src/config/env.ts`, `tests/env.test.ts`; modify relevant provider actions.

1. RED: tests reject missing/malformed provider configuration without exposing values.
2. GREEN: parse backend-only environment variables with Zod and expose capability booleans.
3. Verify secrets never enter event metadata.

**Completion:** startup/tool calls fail closed with named missing-capability errors.

---

## Phase 1 — Durable Commander Workflow (P0)

### Task 3: Add workflow-step persistence

**Files:** modify `convex/schema.ts`; create `convex/workflowSteps.ts`, `tests/workflow.test.ts`.

Add durable step records: incident, run, type, status, attempt, idempotency key, input/output refs, scheduled/start/end timestamps, timeout, error code. Index by incident and idempotency.

**Completion:** duplicate scheduling cannot execute the same step twice and interrupted work can resume.

### Task 4: Implement Commander scheduler

**Files:** create `convex/orchestrator.ts`, `src/orchestrator/planner.ts`; modify `convex/incidents.ts`.

1. RED: incident creation schedules planning exactly once.
2. Implement `startIncident`, `advanceIncident`, and `reviewSpecialistResult` actions.
3. Before each step check current state, deadline, budget, attempts, and idempotency.
4. Schedule the next action through Convex scheduler; do not hold a long HTTP request open.

**Completion:** a fixture incident advances through a legal mode-specific path and survives duplicate action delivery.

### Task 5: Persist agent run lifecycle and handoffs

**Files:** create `convex/agentRuns.ts`, `src/orchestrator/handoff.ts`, `tests/handoff.test.ts`.

Persist queued/running/succeeded/failed runs, parent IDs, bounded redacted input/output summaries, model metadata, tokens, cost, and duration.

**Completion:** a Commander root and specialist children reconstruct into a deterministic tree; no raw secret/body leakage.

---

## Phase 2 — Model Runtime and Dynamic Agent Organization (P0)

### Task 6: Implement structured model client

**Files:** create `src/models/client.ts`, `src/models/prompts/*.ts`, `convex/modelActions.ts`, `tests/model-client.test.ts`.

1. RED: malformed JSON, schema mismatch, timeout, and over-budget calls fail with typed errors.
2. Resolve the persisted agent model profile.
3. Call model provider from Convex action and parse output with the agent's Zod contract.
4. Persist prompt version, model, token counts, cost, latency, and a redacted summary.

**Completion:** model output cannot drive state/tools until schema validation passes.

### Task 7: Implement Diagnoser

**Files:** create `src/agents/diagnoser.ts`, `convex/agents/diagnoser.ts`, `tests/diagnoser.test.ts`.

Give only read tools: recent logs, deploys, commits, code search/read, runbook matches, then Linkup only after local memory fails. Require root cause, confidence, at least two cited evidence items, affected surfaces, risk, repair, files, and forbidden-change flags.

**Completion:** weak evidence is rejected; low confidence cannot reach patching.

### Task 8: Implement dynamic temporary specialist

**Files:** create `src/agents/specialist.ts`; modify `src/orchestrator/commander.ts`, `convex/orchestrator.ts`; add `tests/dynamic-organization.test.ts`.

Spawn only after first unknown diagnosis with no known signature. Scope its tools to provider/runtime read/research operations. Persist `spawnReason`, parent run, granted capabilities, and outcome.

**Completion:** an unknown Cloudflare/runtime fixture visibly spawns a temporary child; known incidents do not.

### Task 9: Implement Fixer and Commander review

**Files:** create `src/agents/fixer.ts`, `convex/agents/fixer.ts`, `tests/fixer-policy.test.ts`.

Fixer receives accepted diagnosis plus explicit constraints. Require minimal patch, regression test, changed-file/line manifest, branch, and PR metadata. Run deterministic policy and secret scan before writes. Commander rejects unsafe/oversized/weak patches.

**Completion:** allowed fixture creates a candidate patch; migration/auth/billing/secret/dependency/blocked-path fixtures write nothing.

### Task 10: Implement Reporter spawn-on-success

**Files:** create `src/agents/reporter.ts`, `convex/agents/reporter.ts`, `tests/reporter-spawn.test.ts`.

Spawn Reporter only when persisted independent verification passes and performance is PASS/WAIVED. Generate PR body, runbook, web summary, and Telegram summary from persisted facts.

**Completion:** failed verification/performance never creates Reporter or runbook.

---

## Phase 3 — Narrow External Tool Gateway (P0)

### Task 11: Build common gateway wrapper

**Files:** create `src/gateway/types.ts`, `src/gateway/execute.ts`, `src/security/redact.ts`, `tests/gateway.test.ts`.

Every tool receives incident/run/idempotency IDs, validates project allowlists, applies timeout/retry, reads secrets internally, redacts outputs, emits start/end events, and returns typed results.

**Completion:** all external calls share one auditable wrapper; agents cannot access arbitrary shell/git/fetch.

### Task 12: Implement GitHub gateway

**Files:** create `src/gateway/github.ts`, `convex/tools/github.ts`, `tests/github-gateway.test.ts`.

Implement read file/search/commits/blame and guarded branch/patch/commit/PR. Prevent writes outside configured repo/path and prevent duplicate branch/commit/PR creation via idempotency.

**Completion:** integration fixture proves read and write contracts; a live dry run creates a branch/PR in the demo repo.

### Task 13: Implement Cloudflare gateway

**Files:** create `src/gateway/cloudflare.ts`, `convex/tools/cloudflare.ts`, `tests/cloudflare-gateway.test.ts`.

Implement deployment list/status, trigger preview/production deployment, preview URL, and rollback. Poll deterministically with timeout and visible progress events.

**Completion:** real deployment ID/URL/status are persisted; failure triggers rollback/escalation path.

### Task 14: Implement exact HTTP verifier

**Files:** create `src/verification/http.ts`, `convex/tools/verify.ts`, `tests/http-verifier.test.ts`.

Replay the original failing method/path/headers/body after safe redaction. Assert status, required schema paths, forbidden error signatures, and clean fresh logs. Do not pass Fixer narrative to Verifier.

**Completion:** deliberate failure cannot pass; repaired external endpoint produces persisted proof.

### Task 15: Implement deterministic performance engine

**Files:** create `src/performance/measure.ts`, `convex/tools/performance.ts`, `tests/performance.test.ts`.

Run warmups plus N calibrated requests, calculate p50/p95/success rate, compare to project tolerance, persist PASS/REGRESSION, and require actor/reason for WAIVED.

**Completion:** regression cannot resolve; deterministic percentile fixtures pass exactly.

---

## Phase 4 — Modes, Approval, Memory, and Intake (P1 after first real recovery)

### Task 16: Complete all three mode paths

**Files:** modify `convex/orchestrator.ts`, `convex/approvals.ts`, `src/orchestrator/state-machine.ts`; add `tests/modes.test.ts`.

Verify Auto Resolve full loop, PR Approval pause/resume, and Investigate Only read-only assignee handoff. Ensure no automatic autonomy upgrade.

**Completion:** all paths have end-to-end fixture tests and expected terminal states.

### Task 17: Runbook matching and verified memory

**Files:** create `convex/runbooks.ts`, `src/memory/match.ts`, `tests/runbooks.test.ts`.

Store only resolved incidents. Search by exact signature first, optional embedding second. Treat matches as hypotheses and require fresh evidence. Record match ID and whether it reduced calls.

**Completion:** repeat fixture uses runbook with fewer calls; memory wipe demonstrably increases MTTR/tool count.

### Task 18: Auto-detection and phone controls

**Files:** create `convex/monitor.ts`, `convex/telegram.ts`, optional webhook handlers; tests for dedupe/approval callbacks.

Implement 3+ errors/60s detection, Telegram `/fix`, approve/reject callbacks, and ElevenLabs voice intake after dashboard flow is stable.

**Completion:** each intake creates one idempotent incident and all notifications link to incident detail.

---

## Phase 5 — L5 Observability (P0/P1)

### Task 19: Define a stable observability event taxonomy

**Files:** create `src/observability/events.ts`, `docs/observability.md`, `tests/events.test.ts`; tighten `convex/schema.ts` metadata.

Event types: incident detected, plan created, run spawned/started/completed/rejected, tool started/completed/failed, state transition, retry, policy decision, approval requested/decided, deployment status, verification assertion, performance sample/verdict, rollback, escalation, runbook matched/stored, notification sent.

Required dimensions: incident, run, parent run, agent, tool, task, attempt, model, prompt version, duration, tokens, cost, evidence refs, idempotency key, error code, timestamp.

**Completion:** every state/agent/tool operation maps to one typed event and no secret-bearing arbitrary metadata remains.

### Task 20: Build trace-tree query

**Files:** create/modify `convex/traces.ts`, `convex/dashboard.ts`, `tests/traces.test.ts`.

Return nested Commander → specialist → tool spans with aggregate tokens, cost, duration, retries, critical path, and current active node.

**Completion:** one query renders the full organization and its live state without client reconstruction guesswork.

### Task 21: Build searchable timeline and filters

**Files:** add schema indexes/search indexes; create `convex/events.ts`.

Support filters by incident, run, agent, tool, event type, status, and time. Provide safe expandable input/output/evidence summaries.

**Completion:** judge can find every failed/retried tool call and its evidence in under ten seconds.

### Task 22: Build run comparison

**Files:** create `convex/comparisons.ts`, `src/observability/compare.ts`, `tests/comparison.test.ts`.

Compare two incidents on path, root cause, runbook use, tool/model calls, retries, tokens, cost, MTTR, verification, and performance.

**Completion:** cold-memory vs warm-memory runs show an explicit delta table.

### Task 23: Add cost/latency budgets and alerts

**Files:** create `src/observability/budget.ts`, `convex/alerts.ts`, `tests/budget.test.ts`.

Aggregate cost/latency per run and incident. Stop loops at budget/deadline. Emit alerts for failure, cost spike, retry exhaustion, and performance regression.

**Completion:** budget breach deterministically escalates and appears in timeline/Telegram.

### Task 24: Specify hero-screen observability contract

**Files:** update `docs/ui-integration-spec.md`; frontend files when UI repo exists.

Required panels: header/status/mode/confidence; live agent tree; chronological timeline; diagnosis/evidence/diff; deploy/PR proof; exact verification assertions; performance before/after; footer totals for tokens/cost/retries/MTTR/human time/runbook.

**Completion:** the screen tells the whole recovery story without verbal narration.

---

## Phase 6 — Evaluation and Live Proof (P0/P1)

### Task 25: Make all eight eval cases executable

**Files:** create `convex/evals.ts`, `src/evals/runner.ts`, fixtures under `tests/fixtures/evals/`, extend `tests/evals.test.ts`.

For each case score root-cause class, mode, tool permissions, changed files, assertions, terminal state, cost, and deadline. Any golden-invariant breach is a hard failure.

**Completion:** one command runs all named cases and persists prompt/model/agent versions and results.

### Task 26: Add release quality gate

**Files:** create `.github/workflows/ci.yml`; modify `package.json` scripts.

Run typecheck, unit tests, scenario evals, secret scan, and skill validation. Fail on invariant regression.

**Completion:** protected main requires green CI.

### Task 27: Execute three real recovery runs

Use the separate external demo app and preserve for each run: incident ID, trace, evidence, diff, commit/PR URL, Cloudflare deployment ID/URL, exact before/after response, clean fresh logs, performance record, cost, duration, and terminal state.

**Completion:** three independently verifiable successful runs exist before judging.

### Task 28: Demonstrate L5 memory delta

Run the same failure cold, warm, then after memory wipe. Compare MTTR, calls, tokens, cost, and evidence quality.

**Completion:** comparison screen proves memory changes behavior while verification remains independent.

---

## Phase 7 — Distribution and Virality Track

This rubric is dominated by meaningful actions (25x) and visitors (10x), so distribution cannot wait until hour seven.

### Task 29: Instrument analytics before launch

Frontend/UI files: add DataFast, PostHog, Plausible, or GA4 with read-only judge access. Track `landing_view`, `demo_started`, `incident_created`, `approval_clicked`, `recovery_viewed`, `github_clicked`, `waitlist_signup`/`account_created`.

**Completion:** unique visitors, referrers, geography, timestamps, and conversion events are visible live and team traffic can be excluded.

### Task 30: Add a meaningful conversion action

Implement one frictionless, auditable action: waitlist signup, sandbox demo request, GitHub install, or account creation. Persist timestamp, source/referrer/UTM, and non-team identity; provide an admin count/list for mentor verification.

**Completion:** mentors can inspect raw actions; signups remain under 50% of unique visitors.

### Task 31: Build launch assets early

Prepare: 30-second failure→agents→deploy→verification clip; one-line hook; architecture/trace screenshot; live URL; GitHub URL; X thread; LinkedIn mirror; community-specific post; notable outreach list.

**Completion:** first build-in-public post is published once the first real tracer bullet works, not at the end.

### Task 32: Run a timed distribution loop

- Early: problem/hook + broken checkout clip.
- Mid-build: live agent trace and independent-verifier differentiation.
- Launch: 30-second recovery clip, live URL, action CTA.
- Follow-up: three-run proof, memory delta, cost/MTTR.
- Reply rapidly to substantive comments; ask peers to test, not merely like.
- Directly send relevant founders/operators a specific demo artifact and ask for technical feedback.

**Completion targets for L5:** 5k–7.5k weighted impressions, 51–100 reactions/comments, multiple notable amplifiers or equivalent institutional pickup, 1k+ verified visitors, and 251–1,000 meaningful actions. Keep weighted impressions plausibly above 10x visitors and visitors at least 2x signups.

### Task 33: Prepare mentor verification pack

Create one judge bookmark folder: native X/LinkedIn analytics, live posts, notable profiles/reshares, read-only analytics dashboard, user/action table, GitHub PRs, Cloudflare dashboard, Convex traces/evals, and the three-run evidence packet.

**Completion:** every rubric claim opens live on the builder's device in under 30 seconds.

---

## Priority and Cut Lines

### Immediate P0 — do next
1. Convex deploy/generated types.
2. One durable Commander→Diagnoser workflow with trace persistence.
3. GitHub/Cloudflare/HTTP narrow gateways.
4. Fixer→deploy→independent verify full tracer bullet.
5. Three repeated live runs.
6. Trace tree/timeline sufficient for hero screen.

### P1 after one live recovery
1. Performance engine.
2. PR Approval and Investigate Only paths.
3. Dynamic specialist and Reporter spawn evidence.
4. Runbook reuse/run comparison.
5. Executable eval dashboard.
6. Telegram, then ElevenLabs/Linkup.

### Cut first if behind
Voice polish, broad settings pages, Dodo, generalized provider abstraction, complex embeddings, global search, and non-hero UI pages.

## Verification Commands

```bash
npm run typecheck
npm test
npm run eval
npm run check
npx convex dev
npm run seed
npm run deploy
```

For live proof, commands are insufficient: verify external URLs, GitHub PR, Cloudflare deployment, exact HTTP request, fresh logs, and performance rows directly.

## Principal Risks

- Convex setup/download blocks deployment: resolve first; do not build around temporary shims.
- Fixed scripted orchestration masquerades as multi-agent: persist plans, spawn reasons, review/rejection, and dynamic children.
- Observability becomes decorative logs: use typed spans/events tied to every real operation.
- Fixer self-verifies: enforce independent input and deterministic assertions.
- L5 claims without live external proof: retain IDs/URLs and repeat three times.
- Distribution starts too late: analytics and first public artifact must ship alongside the first working tracer bullet.
- Viral counts fail anti-spoof checks: preserve referrers/timestamps and maintain plausible impression→visitor→signup ratios.

## Final L5 Acceptance Checklist

- [ ] Real external app goes 500→fixed deployment→verified 200 three times.
- [ ] Commander dynamically delegates, rejects, retries, downgrades, and escalates.
- [ ] Temporary specialist spawn is visible for an unknown issue.
- [ ] Reporter exists only on successful resolution.
- [ ] Full trace tree, timeline, I/O summaries, evidence, tokens, cost, latency, retries, and comparison are live.
- [ ] Verification and performance gates cannot be bypassed.
- [ ] Cold/warm/memory-wiped comparison proves useful memory.
- [ ] Eight evals run automatically and gate release.
- [ ] Telegram/phone operation controls a real incident.
- [ ] Analytics has read-only mentor access and tracks a meaningful action.
- [ ] Social, visitor, and signup evidence is live, attributable, and ratio-consistent.
