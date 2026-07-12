# Hermes Project Context — On-Call Autopilot

This repo is the backend/control plane, never the guarded demo app. Load `skills/on-call-autopilot-implementation/SKILL.md` before implementing incident workflow changes.

## Non-negotiable invariants
- Never mark RESOLVED without persisted passing independent verification and PASS/WAIVED performance.
- Agents decide diagnosis and repair; deterministic code enforces permissions, transitions, assertions, deploy status, and measurements.
- Configured mode is a maximum autonomy ceiling. Downgrades are allowed; automatic upgrades are forbidden.
- Investigate Only performs no repository or deployment writes.
- Credentials stay in backend environment variables and narrow tool adapters; never place secrets in prompts, model output, events, or logs.
- This repo connects to the external app only through shared Convex logs, Cloudflare/GitHub APIs, and public HTTP verification.

## Engineering workflow
- Write or update invariant tests before implementation.
- Keep provider adapters behind typed interfaces and return structured, redacted records.
- Every state/tool/agent action emits an event with incident ID, run ID where applicable, status, duration, and safe metadata.
- Run `npm run check` before declaring completion.
- P0 wins over integrations and UI polish.
