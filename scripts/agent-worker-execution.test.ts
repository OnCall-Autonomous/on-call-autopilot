import { describe, expect, it, vi } from "vitest";
import { classifyWorkerExecution, executeWorkerRun } from "./agent-worker-execution.mjs";

const scanRun = (decision = "ALLOW") => ({
  agent: "TEMP_SPECIALIST",
  inputSummary: JSON.stringify({ kind: "SKILL_SECURITY_SCAN", targetPath: "/allowed/demo" }),
  decision,
});

const verdict = (decision: "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL" | "SCAN_ERROR") => ({
  decision,
  installable: decision === "ALLOW",
  recommendation: decision === "ALLOW" ? "SAFE" : decision === "BLOCK" ? "DO_NOT_INSTALL" : "CAUTION",
  score: decision === "ALLOW" ? 4 : 80,
  counts: { critical: 0, high: 1, medium: 0, low: 0 },
  issues: [{ severity: "HIGH", title: "network (S1)", path: "src/a.ts", startLine: 2 }],
  contentDigest: "sha256:abc",
  scannerVersion: "1.2.3",
  policyVersion: "1",
  fileCount: 2,
  totalBytes: 42,
  durationMs: 7,
  ...(decision === "SCAN_ERROR" ? { error: { code: "PROCESS_FAILED", message: "/secret/raw scanner output" } } : {}),
});

describe("classifyWorkerExecution", () => {
  it("preserves ordinary prose as Hermes execution", () => {
    expect(classifyWorkerExecution({ agent: "DIAGNOSER", inputSummary: "diagnose JSON parsing" })).toEqual({ kind: "HERMES" });
  });

  it.each([
    ["malformed JSON", "{"],
    ["unknown structured kind", JSON.stringify({ kind: "OTHER", targetPath: "/allowed/demo" })],
    ["extra field", JSON.stringify({ kind: "SKILL_SECURITY_SCAN", targetPath: "/allowed/demo", surprise: true })],
    ["missing target", JSON.stringify({ kind: "SKILL_SECURITY_SCAN" })],
  ])("rejects %s", (_label, inputSummary) => {
    expect(() => classifyWorkerExecution({ agent: "TEMP_SPECIALIST", inputSummary })).toThrow(/WORKER_EXECUTION_PAYLOAD_INVALID/);
  });

  it("allows only TEMP_SPECIALIST to request scans", () => {
    expect(() => classifyWorkerExecution({ ...scanRun(), agent: "COMMANDER" })).toThrow(/WORKER_EXECUTION_NOT_AUTHORIZED/);
  });
});

describe("executeWorkerRun", () => {
  const env = { SKILL_SECURITY_ALLOWED_ROOT: "/allowed", SKILL_SECURITY_EXECUTABLE: "/bin/scanner" };

  it("calls the injected scanner with absolute environment configuration", async () => {
    const scanner = vi.fn(async () => verdict("ALLOW"));
    const hermes = vi.fn();
    await executeWorkerRun(scanRun(), { scanSkillSecurity: scanner, runHermes: hermes, env });
    expect(scanner).toHaveBeenCalledWith({ targetPath: "/allowed/demo", allowedRoot: "/allowed", executablePath: "/bin/scanner" });
    expect(hermes).not.toHaveBeenCalled();
  });

  it.each(["ALLOW", "BLOCK", "REQUIRE_APPROVAL"] as const)("returns bounded persistence output for %s", async (decision) => {
    const result = await executeWorkerRun(scanRun(), { scanSkillSecurity: async () => verdict(decision), runHermes: vi.fn(), env });
    const body = JSON.parse(result.output);
    expect(body).toEqual({ ...verdict(decision), installable: decision === "ALLOW" });
    expect(result.durationMs).toBe(7);
    expect(result.output).not.toContain("/allowed/demo");
  });

  it("fails closed with stable bounded errors for missing configuration", async () => {
    await expect(executeWorkerRun(scanRun(), { scanSkillSecurity: vi.fn(), runHermes: vi.fn(), env: {} })).rejects.toMatchObject({
      code: "SKILL_SECURITY_SCAN_CONFIGURATION_ERROR",
    });
  });

  it("maps SCAN_ERROR to a stable failure without scanner details", async () => {
    await expect(executeWorkerRun(scanRun(), { scanSkillSecurity: async () => verdict("SCAN_ERROR"), runHermes: vi.fn(), env })).rejects.toMatchObject({
      code: "SKILL_SECURITY_SCAN_FAILED",
      message: "Skill security scan failed",
      durationMs: 7,
    });
  });

  it("continues to call Hermes for normal runs", async () => {
    const hermes = vi.fn(async () => ({ output: "done", durationMs: 9 }));
    await expect(executeWorkerRun({ agent: "DIAGNOSER", inputSummary: "diagnose" }, { scanSkillSecurity: vi.fn(), runHermes: hermes, env })).resolves.toEqual({ output: "done", durationMs: 9 });
    expect(hermes).toHaveBeenCalledOnce();
  });
});
