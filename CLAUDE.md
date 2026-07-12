# Claude Code Instructions — On-Call Autopilot

Read `HERMES.md`, `docs/architecture.md`, `docs/database-model.md`, `docs/model-orchestration.md`, `docs/evaluation.md`, and `skills/on-call-autopilot-implementation/SKILL.md` before broad changes.

Work backend-first. Do not add the external demo app to this repository. Preserve independent verification: Fixer output is never evidence of recovery. Prefer small typed modules, Zod boundaries, deterministic guards, and tests for every golden invariant. Do not mock a live success in production paths; fixture adapters are allowed only in tests/evals and must be labeled.

Required completion check: `npm run check`. For live integration work, also retain concrete external proof: deployment ID/URL, commit/PR URL, HTTP response assertion record, fresh-log check, and performance result.
