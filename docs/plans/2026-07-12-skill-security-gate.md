# Skill Security Gate Implementation Plan

## Goal

Add a deterministic security-analysis capability for agent skills and MCP packages without copying or forking the scanner implementation. The control plane invokes an externally installed Apache-2.0 scanner through a narrow adapter, validates its JSON contract, maps the upstream recommendation into local policy, and emits safe structured evidence.

## Constraints

- Keep the third-party scanner out of this repository and preserve attribution.
- Static analysis only in V1 (`--no-llm`); no additional model credentials or content egress.
- Execute only in the authenticated local worker, never in Convex actions or public HTTP routes.
- Accept only staged local directories inside an explicitly configured scan root; reject URLs, archives, special files, links, and traversal.
- Use argument arrays without shell interpolation.
- Pin and probe a supported scanner version before use.
- Stage a bounded immutable copy, reject links, compute a content digest, and scan only that copy.
- Run with a minimal credential-free environment, fresh home/cache, a process group, macOS sandbox profile, and network denied.
- Apply timeout, process-group termination, file-count, file-size, total-size, depth, diagnostic-output, and report-size limits.
- Parse and validate the stable JSON fields; ignore unknown extension fields.
- Treat exit 0 or 1 plus valid JSON as a scan verdict; all other exits/signals/timeouts/schema errors fail closed.
- Never treat process exit code alone as the policy verdict.
- Persist/return bounded summaries, not full report bodies.
- Bind any later approval to the content digest, scanner version, and policy version.

## Task 1 — Typed adapter and policy

Create `src/tools/skill-security.ts` and tests.

- Define request, report, issue, decision, and scan-error types.
- Validate the canonical target path against an allowed root and reject every symlink or unsupported filesystem type.
- Stage regular files with explicit resource limits and calculate a SHA-256 digest.
- Build an argument-vector invocation for static JSON output.
- Parse the upstream report.
- Map `SAFE -> ALLOW`, `CAUTION -> REQUIRE_APPROVAL`, `DO_NOT_INSTALL -> BLOCK`; scanner failures become `SCAN_ERROR`.
- Treat `REQUIRE_APPROVAL` and `SCAN_ERROR` as non-installable by default.
- Fail closed on malformed output, timeout, missing executable, or unsupported recommendation.
- Redact absolute paths and bound issue summaries.

## Task 2 — Local worker integration

Extend the authenticated worker with a `skill_security_scan` command.

- Validate command payload.
- Execute through the sandboxed staging service.
- Return structured result with duration/tool version/counts.
- Limit worker concurrency to one scan at a time.
- Keep existing Hermes command behavior unchanged.
- Add command-level tests with an injected fake process runner.

## Task 3 — Documentation and attribution

- Document the exact supported external version/commit and installation as an optional prerequisite.
- Document static-only behavior and policy mapping.
- Add `THIRD_PARTY_NOTICES.md` identifying NVIDIA SkillSpector, its upstream repository, and Apache-2.0; state that it is not bundled or endorsed.
- Make clear that On-Call Autopilot supplies the adapter/policy/orchestration, not the scanner engine.

## Verification

1. Targeted tests RED then GREEN.
2. `npm run typecheck`.
3. `npm test`.
4. `npm run eval`.
5. `npm run check`.
6. `git diff --check`.
7. Install the pinned external scanner in an isolated uv tool environment if absent.
8. Run a real network-denied static scan against repository-owned safe and deliberately unsafe fixtures.
9. Verify allow/block decisions and bounded redacted output.
10. Independent specification review, then code-quality/security review.

## Explicit non-goals for V1

- No MCP or HTTP scanner transport.
- No URL, ZIP, archive, baseline, custom-rule, or LLM scan inputs.
- No claim that an `ALLOW` result proves safety.
- No install/deploy action is included; this phase produces a gate result only.
