# Claude Code Instructions — On-Call Autopilot

Read `HERMES.md`, `docs/architecture.md`, `docs/database-model.md`, `docs/model-orchestration.md`, `docs/evaluation.md`, and `skills/on-call-autopilot-implementation/SKILL.md` before broad changes.

Work backend-first. Do not add the external demo app to this repository. Preserve independent verification: Fixer output is never evidence of recovery. Prefer small typed modules, Zod boundaries, deterministic guards, and tests for every golden invariant. Do not mock a live success in production paths; fixture adapters are allowed only in tests/evals and must be labeled.

Required completion check: `npm run check`. For live integration work, also retain concrete external proof: deployment ID/URL, commit/PR URL, HTTP response assertion record, fresh-log check, and performance result.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
