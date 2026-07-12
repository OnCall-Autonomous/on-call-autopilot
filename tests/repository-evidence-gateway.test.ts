import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RepositoryEvidenceGateway } from "../src/evidence/repository-evidence-gateway";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "evidence-gateway-"));
  const remote = join(root, "remote.git");
  const source = join(root, "source");
  execFileSync("git", ["init", "--bare", remote]);
  execFileSync("git", ["init", "-b", "main", source]);
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: source });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: source });
  mkdirSync(join(source, "src"));
  writeFileSync(join(source, "src", "app.txt"), "alpha\nneedle secret-token=abc\nomega\n");
  writeFileSync(join(source, "outside.txt"), "forbidden\n");
  execFileSync("git", ["add", "."], { cwd: source });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: source });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: source });
  execFileSync("git", ["push", "origin", "main"], { cwd: source });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  return { root, remote, source, sha };
}

function gateway(remote: string, root: string, reproductionArgv = [process.execPath, "-e", "console.log('reproduced')"]) {
  return new RepositoryEvidenceGateway({
    repositories: { demo: { remote, refs: ["refs/heads/main"], pathPrefixes: ["src/"] } },
    checkoutRoot: join(root, "checkouts"), reproductionArgv,
    limits: { maxFileBytes: 64, maxSearchMatches: 2, maxOutputBytes: 64, timeoutMs: 2_000 },
    redact: [/secret-token=[^\s]+/g],
  });
}

describe("RepositoryEvidenceGateway", () => {
  it("resolves an allowlisted ref to an immutable SHA and performs bounded reads/search", async () => {
    const f = fixture();
    const g = gateway(f.remote, f.root);
    const resolved = await g.resolve("demo", "refs/heads/main");
    expect(resolved.sha).toBe(f.sha);
    expect(await g.readFile(resolved, "src/app.txt")).toContain("[REDACTED]");
    const matches = await g.search(resolved, "needle");
    expect(matches).toEqual([{ path: "src/app.txt", line: 2, text: "needle [REDACTED]" }]);
  });

  it("rejects unknown repositories, refs, traversal, and non-allowlisted paths with stable errors", async () => {
    const f = fixture();
    const g = gateway(f.remote, f.root);
    await expect(g.resolve("other", "refs/heads/main")).rejects.toMatchObject({ code: "REPOSITORY_NOT_ALLOWED" });
    await expect(g.resolve("demo", "refs/heads/dev")).rejects.toMatchObject({ code: "REF_NOT_ALLOWED" });
    const r = await g.resolve("demo", "refs/heads/main");
    await expect(g.readFile(r, "../outside.txt")).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
    await expect(g.readFile(r, "outside.txt")).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
  });

  it("runs only the configured command with scrubbed environment and proves source unchanged", async () => {
    const f = fixture();
    const script = "console.log(process.env.HOME === undefined ? 'scrubbed' : 'leaked')";
    const g = gateway(f.remote, f.root, [process.execPath, "-e", script]);
    const r = await g.resolve("demo", "refs/heads/main");
    const evidence = await g.reproduce(r);
    expect(evidence.stdout.trim()).toBe("scrubbed");
    expect(evidence.sourceUnchanged).toBe(true);
    expect(readFileSync(join(f.source, "src/app.txt"), "utf8")).toContain("secret-token=abc");
  });

  it("fails closed when reproduction mutates the isolated source", async () => {
    const f = fixture();
    const g = gateway(f.remote, f.root, [process.execPath, "-e", "require('fs').writeFileSync('src/app.txt','changed')"]);
    const r = await g.resolve("demo", "refs/heads/main");
    await expect(g.reproduce(r)).rejects.toMatchObject({ code: "SOURCE_MUTATED" });
  });

  it("bounds output and reports timeout using stable errors", async () => {
    const f = fixture();
    let g = gateway(f.remote, f.root, [process.execPath, "-e", "console.log('x'.repeat(1000))"]);
    let r = await g.resolve("demo", "refs/heads/main");
    const evidence = await g.reproduce(r);
    expect(Buffer.byteLength(evidence.stdout)).toBeLessThanOrEqual(64);
    expect(evidence.outputTruncated).toBe(true);
    g = gateway(f.remote, f.root, [process.execPath, "-e", "setTimeout(()=>{},10000)"]);
    r = await g.resolve("demo", "refs/heads/main");
    await expect(g.reproduce(r)).rejects.toMatchObject({ code: "REPRODUCTION_TIMEOUT" });
  });
});
