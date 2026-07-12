# On-Call Autopilot (The Doctor)

Backend-first scaffold for an autonomous incident-response crew that guards a separate external demo app. This repository intentionally does not contain the guarded app.

## Implemented foundation
- Convex schema for projects, incidents, traces, deploys, verification, performance, runbooks, approvals, evals, and shared logs.
- Deterministic state-transition and resolution gates.
- Mode downgrade and patch policy guard.
- Typed Zod contracts for Diagnoser, Fixer, Verifier, and Reporter.
- Eight named evaluation cases plus executable golden-invariant tests.
- Project instructions for Hermes and Claude, and a reusable implementation skill.

## Boundary
The backend may only: (1) read shared Convex logs, (2) operate the external app through narrow GitHub/Cloudflare gateway functions, and (3) send real HTTP requests to its public endpoints. Agents never receive credentials.

## Start
```bash
cp .env.example .env.local
npm install
npx convex dev
npm run check
```
Convex generates `convex/_generated` during `convex dev`. Configure a project before running live mutations.

## Structure
- `convex/`: persistent model and server functions.
- `src/orchestrator/`: state machine, agent output contracts, Commander decisions.
- `src/policy/`: deterministic autonomy and patch guard.
- `src/evals/`: versioned evaluation catalog.
- `tests/`: invariant and policy tests.
- `docs/`: architecture, database, orchestration, and evaluation specifications.
- `skills/on-call-autopilot-implementation/SKILL.md`: implementation procedure for coding agents.

## P0 implementation order
1. Tool gateway adapters for Convex logs, GitHub, Cloudflare, and HTTP verification.
2. Durable Commander workflow using Convex actions/scheduled functions.
3. Diagnoser and Fixer with strict structured outputs.
4. External deploy polling and independent exact-request verification.
5. PR creation and real-time event timeline.
6. Three end-to-end recovery runs; only then add P1 integrations.
