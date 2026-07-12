import { describe, expect, it } from "vitest";
import {
  GitHubGateway,
  type CommandRequest,
  type CommandResult,
  type GatewayLimits,
} from "../src/gateway/github-gateway";

const limits: GatewayLimits = {
  allowedRepo: "acme/demo",
  allowedReadPaths: ["src", "tests", "package.json"],
  allowedWritePaths: ["src", "tests"],
  protectedPaths: [".github", "migrations", "src/auth", ".env"],
  maxChangedFiles: 3,
  maxChangedLines: 80,
  maxCommandMs: 30_000,
  maxOutputBytes: 20_000,
};

class FakeRunner {
  readonly calls: CommandRequest[] = [];
  constructor(private readonly responses: CommandResult[] = []) {}
  async run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    return this.responses.shift() ?? { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
  }
}

describe("GitHubGateway read-only diagnosis", () => {
  it("uses public GitHub APIs and an isolated checkout without exposing a write operation", async () => {
    const runner = new FakeRunner([
      { exitCode: 0, stdout: '{"title":"bug"}', stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: '{"state":"failure"}', stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "file body", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "src/a.ts:2:needle", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
      { exitCode: 1, stdout: "reproduced failure", stderr: "", durationMs: 2 },
    ]);
    const gateway = new GitHubGateway(runner, limits, "/work/incident-1");

    const evidence = await gateway.investigate({
      repo: "acme/demo",
      issueNumber: 7,
      ref: "0123456789abcdef0123456789abcdef01234567",
      readPaths: ["src/a.ts"],
      search: { query: "needle", path: "src" },
      reproduction: { executable: "npm", args: ["test", "--", "tests/regression.test.ts"] },
    });

    expect(evidence.issue.stdout).toContain("bug");
    expect(evidence.reproduction.exitCode).toBe(1);
    expect(evidence.checkoutPath).toContain("incident-1");
    expect(runner.calls.map((call) => call.executable)).toEqual(["gh", "gh", "gh", "gh", "git", "git", "npm"]);
    expect(runner.calls.every((call) => call.timeoutMs <= limits.maxCommandMs)).toBe(true);
  });

  it("rejects repositories, paths, refs, and reproduction executables outside the allowlist", async () => {
    const gateway = new GitHubGateway(new FakeRunner(), limits, "/work/incident-1");
    await expect(gateway.readFile("other/demo", "main", "src/a.ts")).rejects.toThrow("REPO_NOT_ALLOWLISTED");
    await expect(gateway.readFile("acme/demo", "main", ".env")).rejects.toThrow("READ_PATH_NOT_ALLOWLISTED");
    await expect(gateway.createCheckout("acme/demo", "main; rm -rf .")).rejects.toThrow("INVALID_GIT_REF");
    await expect(gateway.runReproduction({ executable: "bash", args: ["-c", "anything"] })).rejects.toThrow("REPRODUCTION_COMMAND_NOT_ALLOWLISTED");
  });
});

describe("GitHubGateway guarded patch and PR delivery", () => {
  it("requires a regression test and verifies pushed SHA and PR URL", async () => {
    const runner = new FakeRunner([
      { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "src/a.ts\ntests/a.test.ts\n", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "10\t2\tsrc/a.ts\n8\t0\ttests/a.test.ts\n", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "https://github.com/acme/demo/pull/9\n", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: '{"url":"https://github.com/acme/demo/pull/9","headRefOid":"0123456789abcdef0123456789abcdef01234567"}', stderr: "", durationMs: 1 },
    ]);
    const gateway = new GitHubGateway(runner, limits, "/work/incident-1");

    const result = await gateway.deliverPatch({
      repo: "acme/demo",
      baseRef: "main",
      branch: "fix/incident-1",
      patch: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/tests/a.test.ts b/tests/a.test.ts\n--- a/tests/a.test.ts\n+++ b/tests/a.test.ts\n@@ -0,0 +1 @@\n+test('regression', () => {})\n",
      regressionTestPaths: ["tests/a.test.ts"],
      targetedTest: { executable: "npm", args: ["test", "--", "tests/a.test.ts"] },
      fullTest: { executable: "npm", args: ["test"] },
      commitMessage: "fix: prevent incident regression",
      prTitle: "fix: prevent incident regression",
      prBody: "Diagnosis and reproducible evidence included.",
    });

    expect(result).toEqual({
      branch: "fix/incident-1",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      remoteSha: "0123456789abcdef0123456789abcdef01234567",
      pullRequestUrl: "https://github.com/acme/demo/pull/9",
    });
    expect(runner.calls.some((call) => call.args.includes("merge"))).toBe(false);
  });

  it("rejects protected paths, excessive diffs, and missing regression tests before commit or push", async () => {
    const protectedRunner = new FakeRunner([
      { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: ".github/workflows/ci.yml\n", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "1\t0\t.github/workflows/ci.yml\n", stderr: "", durationMs: 1 },
    ]);
    const gateway = new GitHubGateway(protectedRunner, limits, "/work/incident-1");
    await expect(gateway.deliverPatch({
      repo: "acme/demo", baseRef: "main", branch: "fix/x", patch: "patch",
      regressionTestPaths: ["tests/x.test.ts"], targetedTest: { executable: "npm", args: ["test"] },
      fullTest: { executable: "npm", args: ["test"] }, commitMessage: "fix: x", prTitle: "fix: x", prBody: "body",
    })).rejects.toThrow("PROTECTED_PATH");
    expect(protectedRunner.calls.some((call) => call.args[0] === "push")).toBe(false);

    const missingTestRunner = new FakeRunner([
      { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "src/a.ts\n", stderr: "", durationMs: 1 },
      { exitCode: 0, stdout: "2\t1\tsrc/a.ts\n", stderr: "", durationMs: 1 },
    ]);
    const noTestGateway = new GitHubGateway(missingTestRunner, limits, "/work/incident-2");
    await expect(noTestGateway.deliverPatch({
      repo: "acme/demo", baseRef: "main", branch: "fix/y", patch: "patch",
      regressionTestPaths: ["tests/y.test.ts"], targetedTest: { executable: "npm", args: ["test"] },
      fullTest: { executable: "npm", args: ["test"] }, commitMessage: "fix: y", prTitle: "fix: y", prBody: "body",
    })).rejects.toThrow("REGRESSION_TEST_REQUIRED");
  });
});
