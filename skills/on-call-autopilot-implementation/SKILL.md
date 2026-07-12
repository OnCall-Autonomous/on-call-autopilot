---
name: on-call-autopilot-implementation
description: "Use when implementing or reviewing the backend, orchestration, database, provider gateway, guardrails, or evaluation suite for On-Call Autopilot (The Doctor). Enforces external-service boundaries, deterministic recovery gates, mode ceilings, independent verification, performance checks, and live proof."
version: 1.0.0
author: On-Call Autopilot Team
license: MIT
metadata:
  hermes:
    tags: [incident-response, agents, convex, cloudflare, github, evaluation]
    related_skills: [test-driven-development, systematic-debugging, requesting-code-review]
---

# On-Call Autopilot Implementation

## Overview
Build the control plane that guards a separate external demo service. Optimize for one real, auditable recovery loop before integrations or UI. LLMs propose diagnoses and repairs; deterministic code owns permission, state, deployment status, verification assertions, performance math, and closure.

## When to Use
- Adding a Commander/specialist workflow, state, gateway tool, policy, runbook, or eval.
- Reviewing whether an incident can safely deploy or resolve.
- Integrating Convex, GitHub, Cloudflare, HTTP verification, Telegram, ElevenLabs, or Linkup.
- Do not use this to implement the guarded demo app; it belongs in a separate repository.

## Implementation Workflow
1. Read `HERMES.md` and relevant `docs/*.md`. Identify the state transition and golden invariants affected. Completion: list every invariant that could regress.
2. Add a failing deterministic test first. Include negative paths (forbidden write, failed verification, perf regression, duplicate request). Completion: test fails for the intended missing behavior.
3. Define/adjust typed domain and Zod boundaries. Never accept free-form agent output in control flow. Completion: malformed output is rejected before tools/state writes.
4. Implement least-privilege behavior. External adapters own credentials and expose narrow operations with timeout, retry, idempotency, redaction, and audit events. Completion: agents cannot access raw git/shell/HTTP/secret capabilities.
5. Persist before advancing. Every agent/tool result and state transition must be queryable from Convex. Completion: workflow can resume safely after interruption or duplicate scheduling.
6. Verify independently. Reconstruct the exact failing request from incident evidence; do not consume Fixer claims. Check deterministic assertions and fresh logs. Completion: a failing assertion cannot reach PERF_CHECK.
7. Measure performance after verification. Record baseline, warmups, N samples, p50/p95, success rate, tolerance, and verdict. Completion: regression cannot reach RESOLVED without explicit persisted waiver.
8. Run `npm run check`. For integration changes, execute a real external test and retain IDs/URLs/responses. Completion: tests pass and evidence is factual, not simulated.

## Mode Rules
- AUTO_RESOLVE may write only after high-confidence, low-risk policy approval.
- Medium risk downgrades to PR_APPROVAL.
- Low confidence, blocked files, high risk, migrations, dependencies, auth/billing/secrets downgrade to INVESTIGATE_ONLY.
- PR_APPROVAL may create branch/commit/PR after `DIAGNOSIS_REVIEW → PATCHING → PATCH_REVIEW → PR_READY`, but cannot merge or deploy automatically.
- INVESTIGATE_ONLY cannot patch or perform repository writes. It may fetch public issue/CI metadata, read/search allowlisted files, create an isolated checkout, and run one bounded allowlisted reproduction command to produce a cited diagnosis.
- Never auto-upgrade autonomy above configured mode.

## Agent Contracts
- Diagnoser: read-only; root cause, 0..1 confidence, >=2 cited evidence items, affected surfaces, risk, repair, required files, forbidden-change flags.
- Fixer: accepted diagnosis + exact constraints; minimal patch and regression test; branch/commit/PR/deploy only through gateway.
- Verifier: independent input; exact request, deterministic status/schema/error/log assertions.
- Performance: deterministic requests and percentile math; no LLM needed for measurement.
- Reporter: spawn only after gates pass; summarize persisted facts and create verified runbook.
- Temporary specialist: spawn only for unknown provider/runtime evidence gaps; read/research scope only.

## Database Discipline
Treat `convex/schema.ts` as source of truth. Store workflow retries/deadline/budget durably. Keep `events` append-only and secret-free. Create runbooks only after verified resolution. Add indexes for every incident-time or project-time query; avoid unbounded scans. Use Convex actions for external I/O and mutations for writes.

## Evaluation Discipline
Run all eight named scenarios on every prompt/agent version. Score structured expected outcomes and hard invariants, not prose similarity. Turn every failed live incident into an eval. Before judging, run the complete external path three times and retain the full evidence packet.

## Common Pitfalls
1. Calling a Fixer response verification. Fix: Verifier replays the exact external request independently.
2. Letting model text drive state directly. Fix: parse Zod output, then deterministic review and transition validation.
3. Keeping orchestration only in process memory. Fix: persist step state/counters and schedule resumable work.
4. Mocking the judged path. Fix: fixtures are test-only; live acceptance requires external URLs and IDs.
5. Logging secrets or full sensitive bodies. Fix: redact in the gateway before events/model context.
6. Adding Telegram/voice before recovery works. Fix: finish and repeat the P0 tracer bullet first.

## Verification Checklist
- [ ] External demo app remains outside this repository.
- [ ] State transition and policy tests cover changed behavior.
- [ ] No raw credentials reach agents or audit records.
- [ ] Configured mode remains an autonomy ceiling.
- [ ] Independent verification and fresh logs are persisted.
- [ ] Performance PASS/WAIVED is persisted before resolution.
- [ ] All run/tool actions have trace, cost, and duration data.
- [ ] `npm run check` passes.
- [ ] Live claims include verifiable external evidence.
