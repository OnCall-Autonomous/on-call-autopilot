import { chmod, link, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SKILL_SECURITY_LIMITS, parseSkillSpectorReport, scanSkillSecurity, type ProcessRunner, type RunnerRequest } from "../../src/tools/skill-security";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skill-security-test-")); const target = join(root, "skill"); const executable = join(root, "skillspector");
  await mkdir(target); await writeFile(join(target, "SKILL.md"), "# harmless\n"); await writeFile(executable, "#!/bin/sh\n"); await chmod(executable, 0o755);
  return { root, target, executable };
}

const report = (recommendation = "SAFE", severity = recommendation === "SAFE" ? "LOW" : recommendation === "CAUTION" ? "MEDIUM" : "HIGH", overrides: Record<string, unknown> = {}) => JSON.stringify({
  skill: "example", risk_assessment: { score: 97, severity, recommendation }, components: {},
  issues: [{ id: "SS001", category: "permissions", severity: "LOW", confidence: 0.9, location: { file: "SKILL.md", start_line: 1 }, description: "untrusted" }],
  metadata: { skillspector_version: "1.2.3", llm_requested: false, llm_available: false }, ...overrides,
});

function runner(result: Record<string, unknown> = {}) {
  const calls: RunnerRequest[] = [];
  const run: ProcessRunner = async request => { calls.push(request); return request.args[0] === "--version"
    ? { exitCode: 0, signal: null, timedOut: false, stdout: "SkillSpector 1.2.3", stderr: "" }
    : { exitCode: 0, signal: null, timedOut: false, stdout: "diagnostic", stderr: "", report: report(), ...result }; };
  return { runner: run, calls };
}

describe("parseSkillSpectorReport", () => {
  it.each([["SAFE", "LOW", "ALLOW", true], ["CAUTION", "MEDIUM", "REQUIRE_APPROVAL", false], ["DO_NOT_INSTALL", "CRITICAL", "BLOCK", false]])("maps documented %s contract", (recommendation, severity, decision, installable) => {
    expect(parseSkillSpectorReport(report(recommendation, severity))).toMatchObject({ decision, installable });
  });
  it("derives bounded stable issue summaries and counts validated issues", () => {
    const parsed = parseSkillSpectorReport(report("CAUTION", "MEDIUM", { issues: Array.from({ length: 25 }, (_, i) => ({ id: `I${i}`, category: "danger", severity: "HIGH", confidence: .8, location: { file: "/Users/alice/private/SKILL.md", start_line: i + 1 }, description: "secret" })) }));
    expect(parsed.counts.high).toBe(25); expect(parsed.issues).toHaveLength(DEFAULT_SKILL_SECURITY_LIMITS.maxIssueSummaries);
    expect(JSON.stringify(parsed.issues)).not.toContain("secret"); expect(JSON.stringify(parsed.issues)).not.toContain("/Users/alice");
  });
  it.each([
    ["legacy shape", JSON.stringify({ recommendation: "SAFE", score: 1, issues: [] })],
    ["non-static", report("SAFE", "LOW", { metadata: { skillspector_version: "1.2.3", llm_requested: true } })],
    ["score range", report("SAFE", "LOW", { risk_assessment: { score: 101, severity: "LOW", recommendation: "SAFE" } })],
    ["contradiction", report("SAFE", "HIGH")],
    ["unknown issue severity", report("SAFE", "LOW", { issues: [{ id: "x", category: "x", severity: "INFO", confidence: .5, location: { file: "x", start_line: 1 } }] })],
  ])("rejects %s", (_name, body) => expect(() => parseSkillSpectorReport(body)).toThrow());
});

describe("scanSkillSecurity", () => {
  it("uses exact current CLI, static metadata, constrained sandbox, and explicit private report", async () => {
    const f = await fixture(); const fake = runner(); const result = await scanSkillSecurity({ targetPath: f.target, allowedRoot: f.root, executablePath: f.executable }, fake.runner);
    expect(result).toMatchObject({ decision: "ALLOW", scannerVersion: "1.2.3", fileCount: 1 });
    expect(fake.calls[1].args).toEqual(["scan", fake.calls[1].sandbox.inputPath, "--no-llm", "--format", "json", "--output", join(fake.calls[1].sandbox.outputPath, "report.json")]);
    expect(fake.calls[1].sandbox.profile).not.toMatch(/\(allow file-read\*\)\s/); expect(fake.calls[1].sandbox.profile).toContain(fake.calls[1].sandbox.inputPath);
  });
  it("fails closed when private report is missing even if stdout is JSON", async () => {
    const f = await fixture(); const fake = runner({ report: undefined, stdout: report() });
    expect(await scanSkillSecurity({ targetPath: f.target, allowedRoot: f.root, executablePath: f.executable }, fake.runner)).toMatchObject({ decision: "SCAN_ERROR", error: { code: "MISSING_REPORT" } });
  });
  it("fails closed when report and probe versions disagree", async () => {
    const f = await fixture(); const fake = runner({ report: report("SAFE", "LOW", { metadata: { skillspector_version: "1.2.4", llm_requested: false } }) });
    expect(await scanSkillSecurity({ targetPath: f.target, allowedRoot: f.root, executablePath: f.executable }, fake.runner)).toMatchObject({ decision: "SCAN_ERROR", error: { code: "VERSION_MISMATCH" } });
  });
  it.each([["timeout", { timedOut: true }], ["signal", { signal: "SIGKILL" }], ["bad exit", { exitCode: 2 }], ["malformed", { report: "{" }], ["oversized", { stdout: "x".repeat(DEFAULT_SKILL_SECURITY_LIMITS.maxStdoutBytes + 1) }]])("fails closed on %s", async (_n, outcome) => {
    const f = await fixture(); expect(await scanSkillSecurity({ targetPath: f.target, allowedRoot: f.root, executablePath: f.executable }, runner(outcome).runner)).toMatchObject({ decision: "SCAN_ERROR", installable: false });
  });
  it("accepts warning exit with valid block verdict", async () => { const f = await fixture(); expect(await scanSkillSecurity({ targetPath: f.target, allowedRoot: f.root, executablePath: f.executable }, runner({ exitCode: 1, report: report("DO_NOT_INSTALL", "HIGH") }).runner)).toMatchObject({ decision: "BLOCK" }); });
  it("rejects unsupported version before scan", async () => { const f = await fixture(); const calls: RunnerRequest[] = []; const run: ProcessRunner = async r => { calls.push(r); return { exitCode: 0, signal: null, timedOut: false, stdout: "SkillSpector 9.0.0", stderr: "" }; }; expect(await scanSkillSecurity({ targetPath: f.target, allowedRoot: f.root, executablePath: f.executable }, run)).toMatchObject({ decision: "SCAN_ERROR" }); expect(calls).toHaveLength(1); });
  it("rejects links", async () => { const f = await fixture(); await symlink(join(f.target, "SKILL.md"), join(f.target, "alias")); expect(await scanSkillSecurity({ targetPath: f.target, allowedRoot: f.root, executablePath: f.executable }, runner().runner)).toMatchObject({ decision: "SCAN_ERROR" }); const h = await fixture(); await link(join(h.target, "SKILL.md"), join(h.target, "hard")); expect(await scanSkillSecurity({ targetPath: h.target, allowedRoot: h.root, executablePath: h.executable }, runner().runner)).toMatchObject({ decision: "SCAN_ERROR" }); });
});
