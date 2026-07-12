# On-Call Autopilot Backend PRD Execution Plan

> **For Hermes:** Use the subagent-driven-development skill to implement this plan task-by-task, with a deterministic phase gate plus independent specification and code-quality review before each delivery commit.

**Goal:** Turn the existing Convex control-plane foundation into a durable, dynamically orchestrated software-maintenance agency that takes a real task through reproduction, guarded repair, independent verification, evaluation gating, and real pull-request delivery.

**Architecture:** Convex owns task state, durable scheduling, run lineage, events, evidence, policy decisions, evaluations, approvals, and delivery artifacts. Hermes acts as the manager/coding interface and delegates specialist work through narrow typed tools. Models propose plans and artifacts; deterministic services authorize tools, validate patches, run tests, evaluate invariants, and decide whether delivery is permitted.

**Tech Stack:** TypeScript, Convex actions/mutations/queries/scheduled functions, Hermes agent delegation, GitHub API, Cloudflare API, Zod, Vitest, `convex-test`, optional OpenTelemetry export after Convex-native tracing works.

---

## Current baseline

- [x] Convex project, incident, agent-run, event, deployment, verification, performance, runbook, approval, eval, and log schema exists.
- [x] Project, incident, overview, model, and approval HTTP APIs exist.
- [x] Deterministic state-transition and resolution gates exist.
- [x] Risk/autonomy policy guard exists.
- [x] Structured Diagnoser, Fixer, Verifier, and Reporter contracts exist.
- [x] Eight named evaluation definitions exist.
- [x] Unit tests cover state, policy, API contracts, and eval catalog.
- [x] Incident creation has replay-safe idempotency work on a feature branch.
- [x] Durable workflow-step lifecycle work has landed on backend `main`.
- [ ] Hermes/model execution is wired to the control plane.
- [ ] Manager creates and validates task-specific plans.
- [ ] Specialist tools operate real repositories through a gateway.
- [ ] Complete telemetry is emitted by every model/tool/state operation.
- [ ] Named cases execute against the real pipeline and block release.
- [ ] Independent verifier creates persisted proof.
- [ ] Real branch, commit, and PR delivery works end to end.
- [ ] Three structurally different real runs are preserved as evidence.

## Definition of done

Backend V1 is complete when a submitted real task causes a durable manager to choose a task-specific graph, delegate only required specialists with scoped tools, reproduce the failure, produce a policy-compliant minimal patch, run independent deterministic verification, pass an automated eval/release gate, and create a real branch/commit/PR with a complete persisted evidence trail. Risky work must escalate without unauthorized writes.

---

## Phase B0 — Reconcile branches and lock contracts

### Task B0.1: Reconcile existing idempotency and workflow-step work

**Files:** Existing incident, workflow-step, documentation, and test files only.

**Checklist:**
- [ ] Start from current `origin/main`.
- [ ] Replay the pushed idempotency feature without resurrecting the stale local index.
- [ ] Resolve any interaction with durable workflow steps.
- [ ] Confirm incident intake and workflow-step scheduling are independently idempotent.
- [ ] Run the full backend gate before new runtime work.
- [ ] Preserve unrelated local work outside the delivery branch.

### Task B0.2: Define canonical task, plan, handoff, and telemetry contracts

**Files:**
- Create: `src/orchestrator/task-contracts.ts`
- Modify: `src/orchestrator/contracts.ts`
- Modify: `src/domain/types.ts`
- Create tests under `tests/`

**Checklist:**
- [ ] Add intake lanes: incident, GitHub issue, CI failure, documentation, agent failure.
- [ ] Add unified task statuses from received through delivered/escalated/failed verification.
- [ ] Add typed plan nodes with capability, dependencies, allowed tools, acceptance criteria, and state.
- [ ] Add typed handoff: objective, evidence, decisions, allowed/prohibited actions, expected artifact, acceptance criteria.
- [ ] Add canonical telemetry event envelope.
- [ ] Add evidence and final evidence-packet contracts.
- [ ] Validate plans are acyclic and use only allowed capabilities.

---

## Phase B1 — Convex persistence and telemetry

### Task B1.1: Extend schema for dynamic plans and durable artifacts

**Files:**
- Modify: `convex/schema.ts`
- Create/modify: dedicated Convex modules and `convex-test` suites

**Checklist:**
- [ ] Persist task lane and original public source reference.
- [ ] Persist plan nodes and dependency edges.
- [ ] Persist plan revisions and manager decisions.
- [ ] Persist policy decisions with machine-readable reasons.
- [ ] Persist evidence artifacts and hashes/references.
- [ ] Persist patch summaries and PR delivery records.
- [ ] Add indexes required by incident, run, trace, plan, and evaluation queries.
- [ ] Use bounded summaries; do not persist credentials or unlimited raw output.

### Task B1.2: Implement canonical run/event lifecycle

**Files:**
- Create: `convex/runs.ts`
- Create: `convex/events.ts`
- Test: `convex/runs.test.ts`, `convex/events.test.ts`

**Checklist:**
- [ ] `startRun` records parent lineage and immutable run identity.
- [ ] `finishRun` records output summary, token/cost/duration, and success.
- [ ] `failRun` records stable error code and retry eligibility.
- [ ] `recordEvent` accepts canonical envelope and enforces sequence/idempotency.
- [ ] State transitions always emit events.
- [ ] Duplicate event delivery cannot inflate costs or create false transitions.
- [ ] Redaction/summarization happens before persistence.

### Task B1.3: Add telemetry aggregation queries

**Checklist:**
- [ ] Trace tree by parent run.
- [ ] Ordered task timeline.
- [ ] Total/model/tool duration.
- [ ] Input/output tokens and cost.
- [ ] Attempts and budget remaining.
- [ ] Slowest and most expensive step.
- [ ] Loop, cost-spike, and abnormal-tool-count indicators.
- [ ] Final evidence packet query for frontend and PR body.

---

## Phase B2 — Manager and dynamic planning

### Task B2.1: Implement deterministic intake classification boundary

**Files:**
- Create: `src/orchestrator/classifier.ts`
- Test: `tests/classifier.test.ts`

**Checklist:**
- [ ] Classify supported lanes using explicit input evidence.
- [ ] Reject unsupported/private/inaccessible sources with actionable status.
- [ ] Detect high-risk migration, dependency, auth, billing, secret, and protected-path cues.
- [ ] Assign maximum autonomy, budget, deadline, and retry caps.
- [ ] Persist classification evidence and confidence.

### Task B2.2: Implement manager plan proposal and validator

**Files:**
- Create: `src/orchestrator/planner.ts`
- Create: `src/orchestrator/plan-validator.ts`
- Test: corresponding unit/scenario suites

**Checklist:**
- [ ] Manager proposes a plan from capability nodes, not arbitrary executable code.
- [ ] CI/code task includes reproduce, patch, test, verify, review, PR.
- [ ] Documentation task skips deployment.
- [ ] Agent failure includes trace investigation, eval creation, repair, regression gate.
- [ ] High-risk task produces advisory/escalation path.
- [ ] Validator rejects cycles, forbidden tools, missing verification, and incompatible nodes.
- [ ] Persist selected and skipped specialists with reasons.

### Task B2.3: Add manager review and revision loop

**Checklist:**
- [ ] Review every specialist output against node acceptance criteria.
- [ ] Accept, request revision, spawn an allowed specialist, or escalate.
- [ ] Limit revisions and persist feedback.
- [ ] Demonstrate at least one inadequate output returning to a specialist.
- [ ] Prevent narrative completion from changing terminal state.

---

## Phase B3 — Hermes and model execution

### Task B3.1: Build model/provider abstraction

**Files:**
- Create: `src/models/client.ts`
- Create: `src/models/cost.ts`
- Test with recorded/mock provider fixtures

**Checklist:**
- [ ] Select provider/model from `modelProfiles` configuration.
- [ ] Validate structured outputs with Zod.
- [ ] Record prompt and agent versions.
- [ ] Record tokens, cost, latency, retries, and provider errors.
- [ ] Apply timeouts and budget checks.
- [ ] Never log credentials or full secret-bearing prompts.
- [ ] Use deterministic services without a model where appropriate.

### Task B3.2: Wire Hermes as manager/coding interface

**Checklist:**
- [ ] Document Hermes ownership of planning/delegation and tool execution.
- [ ] Correlate Hermes session/delegation IDs with Convex trace/run IDs.
- [ ] Convert task state into bounded specialist handoffs.
- [ ] Capture specialist completion/failure in Convex.
- [ ] Ensure specialists cannot bypass the tool gateway.
- [ ] Persist enough evidence to reproduce decisions without storing hidden reasoning.

### Task B3.3: Implement specialist capability registry

**Checklist:**
- [ ] Investigator/Reproducer.
- [ ] Patch Engineer.
- [ ] Verification Engineer.
- [ ] PR Reviewer/Reporter.
- [ ] Documentation Specialist.
- [ ] Agent Evaluation Specialist.
- [ ] Security/Database advisory specialist.
- [ ] Each capability has explicit tools, prohibited actions, input schema, and output schema.

---

## Phase B4 — Scoped tool gateway and real repository work

### Task B4.1: Implement gateway foundation

**Files:**
- Create: `src/tools/contracts.ts`
- Create: `src/tools/gateway.ts`
- Create: `src/tools/policy.ts`
- Add tests under `tests/tools/`

**Checklist:**
- [ ] Every call requires task/run/idempotency identifiers.
- [ ] Verify repository allowlist and task autonomy before execution.
- [ ] Enforce path, changed-file, changed-line, timeout, and cost limits.
- [ ] Emit tool start/end/failure events.
- [ ] Redact output metadata.
- [ ] Return typed results and stable error codes.
- [ ] Deny arbitrary shell/network/credential access by default.

### Task B4.2: Add read and reproduction tools

**Checklist:**
- [ ] Fetch GitHub issue and CI metadata.
- [ ] Read allowlisted repository files and search results.
- [ ] Create isolated checkout/worktree.
- [ ] Run bounded reproduction command.
- [ ] Capture command, exit code, expected/actual behavior, and artifact references.
- [ ] Prevent writes during investigator runs.

### Task B4.3: Add guarded patch tools

**Checklist:**
- [ ] Create feature branch from current target branch.
- [ ] Apply only allowlisted patch.
- [ ] Reject dependency, migration, secret, billing/auth, or protected-path changes unless explicitly approved.
- [ ] Require regression test for code repair.
- [ ] Record diff hash and summary.
- [ ] Keep credentials behind the gateway.

### Task B4.4: Add deterministic test and verification tools

**Checklist:**
- [ ] Re-run original failing command.
- [ ] Run targeted regression test.
- [ ] Run repository canonical lint/type/test/build gates.
- [ ] Run endpoint assertions for live incidents when applicable.
- [ ] Record clean-checkout provenance.
- [ ] Verifier uses independent workspace and does not accept fixer narrative.
- [ ] Failed verification leads to revision, rollback, or escalation—not delivery.

### Task B4.5: Add GitHub delivery tools

**Checklist:**
- [ ] Commit only scoped files.
- [ ] Push feature branch.
- [ ] Open draft/final PR according to policy.
- [ ] Include task, reproduction, diff, verification, eval, cost, and trace references in PR body.
- [ ] Verify remote branch SHA and PR URL.
- [ ] Never merge unless separately and explicitly authorized.

---

## Phase B5 — Durable orchestration execution

### Task B5.1: Implement scheduled task runner

**Files:**
- Create: Convex action/mutation modules for orchestrator scheduling
- Test: `convex-test` plus mocked external-action fixtures

**Checklist:**
- [ ] Schedule one durable node at a time rather than holding a request open.
- [ ] Claim workflow steps idempotently.
- [ ] Check state, policy, deadline, budget, and attempts before work.
- [ ] Persist node output before scheduling dependents.
- [ ] Recover safely after duplicate delivery or process failure.
- [ ] Stop scheduling after terminal state.

### Task B5.2: Enforce task-appropriate terminal conditions

**Checklist:**
- [ ] Code task requires test/verification and PR artifact.
- [ ] Documentation task requires link/example checks and PR artifact.
- [ ] Live incident requires endpoint/log verification.
- [ ] Agent repair requires new regression eval plus broader suite.
- [ ] Unsafe task requires persisted escalation artifact.
- [ ] No direct write can mark delivered without querying required evidence.

---

## Phase B6 — Evaluation and release gating

### Task B6.1: Convert named evals into executable scenarios

**Files:**
- Modify: `src/evals/cases.ts`
- Create: `src/evals/runner.ts`
- Create: `src/evals/invariants.ts`
- Add unit/integration tests

**Checklist:**
- [ ] Each case defines lane, fixture, expected plan, forbidden actions, expected terminal state, and assertions.
- [ ] Execute through the real manager and policy pipeline.
- [ ] Persist prompt version, agent version, model, cost, duration, and invariant results.
- [ ] Hard invariant breach fails regardless of textual quality.
- [ ] Candidate prompt/agent release is blocked on regression.

### Task B6.2: Establish an acceptable score

Use a deterministic weighted score for quality reporting, while retaining hard gates:

- Task outcome and artifact correctness: 35 points.
- Independent verification: 25 points.
- Policy/safety compliance: 20 points.
- Plan/task-type correctness: 10 points.
- Cost/latency budget compliance: 10 points.

**Acceptance:**
- [ ] Every hard invariant passes.
- [ ] Named-suite score is at least 85/100.
- [ ] No case creates an unauthorized write.
- [ ] No failed verification reaches delivery.
- [ ] At least 4/5 V1 named scenarios pass before demo; target 5/5.
- [ ] Three live structurally different runs succeed independently.
- [ ] Report score, pass rate, cost, and latency separately; do not hide a safety failure inside an average.

### Task B6.3: Add failure-to-eval candidate workflow

**Checklist:**
- [ ] Failed production task can create a candidate eval.
- [ ] Human approves expected behavior before permanent inclusion.
- [ ] Case is version controlled.
- [ ] Proposed repair runs against new case and full suite.
- [ ] Improvement creates guarded PR; no self-approved production prompt update.

---

## Phase B7 — Memory and verified learning

### Task B7.1: Implement practical three-layer memory

**Checklist:**
- [ ] Current task memory: brief, evidence, plan, constraints, state.
- [ ] Repository history: accepted PRs, prior incidents, rejected approaches, maintainer preferences.
- [ ] Policy knowledge: protected paths, approval rules, required checks, escalation rules.
- [ ] Retrieval is scoped by project/repository.
- [ ] Retrieved history is treated as a hypothesis until current evidence confirms it.
- [ ] Only verified outcomes update runbooks.

---

## Phase B8 — Partner integrations after root loop

### Task B8.1: Cloudflare and Convex proof

- [ ] Public frontend/preview deployment.
- [ ] Real endpoint verification when task requires it.
- [ ] Convex live state, trace, evaluation, and approval evidence.

### Task B8.2: Additional integrations

- [ ] Linkup performs research for one real unknown error/dependency question.
- [ ] ElevenLabs voice brief creates a real task.
- [ ] Dodo provides one real checkout/task-credit path without a custom billing system.
- [ ] Wispr proof is recorded if used during event preparation.
- [ ] Integrations emit the same run/tool telemetry as core tools.

---

## Phase B9 — Real-task proof and demo hardening

### Task B9.1: Complete three structurally different real runs

**Checklist:**
- [ ] Code/CI failure produces a tested PR.
- [ ] Documentation or maintenance task produces a different graph and skips deployment.
- [ ] Agent-eval failure creates a regression case and repair PR, or a risky task demonstrates escalation if the AgentFix lane is not ready.
- [ ] At least one specialist output is rejected and revised.
- [ ] Each run preserves task, trace, plan, evidence, diff, verification, eval, cost, duration, branch, commit, and PR.
- [ ] Real repository owner/maintainer usefulness confirmation is recorded where possible.

---

## Backend verification gates

Run after every implementation phase:

```bash
npm run typecheck
npm test
npm run eval
npm run check
git diff --check
```

For Convex behavior, require targeted `convex-test` coverage for schema, mutations, side effects, idempotency, state transitions, and evidence counts. For external tools, use recorded fixtures locally and a separately labelled live smoke before claiming real integration.

## Backend PRD completion checklist

- [ ] Real public task intake is persisted.
- [ ] Hermes manager is wired and trace-correlated.
- [ ] Manager creates validated task-specific graphs.
- [ ] Two task types produce different graphs.
- [ ] Revision loop and policy escalation are demonstrated.
- [ ] Specialists receive typed bounded handoffs.
- [ ] Tool gateway enforces least privilege and emits telemetry.
- [ ] Every model/tool/state action is persisted.
- [ ] Reproduction evidence is real and replayable.
- [ ] Patch remains inside policy boundaries.
- [ ] Independent verifier uses a separate workspace.
- [ ] Failed verification cannot deliver.
- [ ] Executable named evals gate release.
- [ ] Eval score is at least 85/100 with all hard invariants passing.
- [ ] Cost, latency, tokens, attempts, and errors are reported.
- [ ] Real branch, commit, and PR are created and remotely verified.
- [ ] Verified outcome updates repository history/runbook; unverified outcome does not.
- [ ] Three structurally different real runs are preserved.
- [ ] Full deterministic gates and live smoke pass on the exact delivery branch.
