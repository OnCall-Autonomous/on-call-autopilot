import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { basename, posix, resolve, sep } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type ErrorCode =
  | "REPOSITORY_NOT_ALLOWED" | "REF_NOT_ALLOWED" | "REF_RESOLUTION_FAILED"
  | "PATH_NOT_ALLOWED" | "FILE_TOO_LARGE" | "READ_FAILED"
  | "REPRODUCTION_FAILED" | "REPRODUCTION_TIMEOUT" | "SOURCE_MUTATED";

export class EvidenceGatewayError extends Error {
  constructor(readonly code: ErrorCode, message: string = code) { super(message); this.name = "EvidenceGatewayError"; }
}

export interface ResolvedRepository { repository: string; ref: string; sha: string; }
export interface SearchMatch { path: string; line: number; text: string; }
export interface ReproductionEvidence {
  repository: string; sha: string; argv: readonly string[]; exitCode: number; durationMs: number;
  stdout: string; stderr: string; outputTruncated: boolean; sourceUnchanged: boolean;
}
interface RepositoryPolicy { remote: string; refs: readonly string[]; pathPrefixes: readonly string[]; }
interface Limits { maxFileBytes: number; maxSearchMatches: number; maxOutputBytes: number; timeoutMs: number; }
export interface GatewayConfig {
  repositories: Readonly<Record<string, RepositoryPolicy>>; checkoutRoot: string;
  reproductionArgv: readonly [string, ...string[]] | readonly string[]; limits: Limits; redact?: readonly RegExp[];
}

export class RepositoryEvidenceGateway {
  constructor(private readonly config: GatewayConfig) {
    if (config.reproductionArgv.length === 0) throw new Error("reproductionArgv must not be empty");
  }

  async resolve(repository: string, ref: string): Promise<ResolvedRepository> {
    const policy = this.policy(repository);
    if (!policy.refs.includes(ref)) throw new EvidenceGatewayError("REF_NOT_ALLOWED");
    try {
      const { stdout } = await exec("git", ["ls-remote", policy.remote, ref], { timeout: this.config.limits.timeoutMs, maxBuffer: 1024 * 1024 });
      const sha = stdout.trim().split(/\s+/)[0] ?? "";
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("missing full SHA");
      return { repository, ref, sha };
    } catch (error) { throw new EvidenceGatewayError("REF_RESOLUTION_FAILED", String(error)); }
  }

  async readFile(target: ResolvedRepository, path: string): Promise<string> {
    const normalized = this.allowedPath(target.repository, path);
    try {
      const { stdout } = await exec("git", ["--git-dir", await this.mirror(target), "show", `${target.sha}:${normalized}`], {
        encoding: "buffer", maxBuffer: this.config.limits.maxFileBytes + 1,
      });
      const data = Buffer.from(stdout);
      if (data.length > this.config.limits.maxFileBytes) throw new EvidenceGatewayError("FILE_TOO_LARGE");
      return this.redact(data.toString("utf8"));
    } catch (error) {
      if (error instanceof EvidenceGatewayError) throw error;
      if ((error as { code?: string }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw new EvidenceGatewayError("FILE_TOO_LARGE");
      throw new EvidenceGatewayError("READ_FAILED");
    }
  }

  async search(target: ResolvedRepository, query: string): Promise<SearchMatch[]> {
    if (!query || query.includes("\0")) throw new EvidenceGatewayError("READ_FAILED");
    const mirror = await this.mirror(target);
    const policy = this.policy(target.repository);
    const { stdout } = await exec("git", ["--git-dir", mirror, "grep", "-n", "-F", "--", query, target.sha, "--", ...policy.pathPrefixes], { maxBuffer: 1024 * 1024 }).catch((error) => {
      if (error.code === 1) return { stdout: "", stderr: "" };
      throw new EvidenceGatewayError("READ_FAILED");
    });
    return stdout.split("\n").filter(Boolean).slice(0, this.config.limits.maxSearchMatches).map((row) => {
      const match = row.match(/^[^:]+:([^:]+):(\d+):(.*)$/);
      if (!match) throw new EvidenceGatewayError("READ_FAILED");
      return { path: match[1], line: Number(match[2]), text: this.redact(match[3]) };
    });
  }

  async reproduce(target: ResolvedRepository): Promise<ReproductionEvidence> {
    const started = Date.now();
    const checkout = await this.checkout(target);
    const [command, ...args] = this.config.reproductionArgv;
    const result = await runBounded(command, args, checkout, this.config.limits).catch((error) => {
      if (error instanceof EvidenceGatewayError) throw error;
      throw new EvidenceGatewayError("REPRODUCTION_FAILED");
    });
    const { stdout: status } = await exec("git", ["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"], { cwd: checkout });
    if (status.length > 0) throw new EvidenceGatewayError("SOURCE_MUTATED");
    return { repository: target.repository, sha: target.sha, argv: [...this.config.reproductionArgv], exitCode: result.exitCode,
      durationMs: Date.now() - started, stdout: this.redact(result.stdout), stderr: this.redact(result.stderr),
      outputTruncated: result.truncated, sourceUnchanged: true };
  }

  private policy(repository: string): RepositoryPolicy {
    const policy = this.config.repositories[repository];
    if (!policy) throw new EvidenceGatewayError("REPOSITORY_NOT_ALLOWED");
    return policy;
  }
  private allowedPath(repository: string, path: string): string {
    const normalized = posix.normalize(path.replaceAll("\\", "/"));
    if (normalized.startsWith("../") || normalized.startsWith("/") || normalized.includes("\0") || normalized === ".") throw new EvidenceGatewayError("PATH_NOT_ALLOWED");
    if (!this.policy(repository).pathPrefixes.some((prefix) => normalized.startsWith(prefix))) throw new EvidenceGatewayError("PATH_NOT_ALLOWED");
    return normalized;
  }
  private async mirror(target: ResolvedRepository): Promise<string> {
    const root = resolve(this.config.checkoutRoot);
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(`${root}${sep}mirror-`);
    await exec("git", ["clone", "--bare", "--filter=blob:none", this.policy(target.repository).remote, directory], { timeout: this.config.limits.timeoutMs });
    await exec("git", ["--git-dir", directory, "cat-file", "-e", `${target.sha}^{commit}`]);
    return directory;
  }
  private async checkout(target: ResolvedRepository): Promise<string> {
    const mirror = await this.mirror(target);
    const directory = await mkdtemp(`${resolve(this.config.checkoutRoot)}${sep}checkout-${basename(target.repository)}-`);
    await exec("git", ["clone", "--no-checkout", mirror, directory]);
    await exec("git", ["checkout", "--detach", target.sha], { cwd: directory });
    return directory;
  }
  private redact(value: string): string { return (this.config.redact ?? []).reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value); }
}

function runBounded(command: string, args: string[], cwd: string, limits: Limits): Promise<{ exitCode: number; stdout: string; stderr: string; truncated: boolean }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), truncated = false, timedOut = false;
    const append = (current: Buffer, chunk: Buffer) => { const available = Math.max(0, limits.maxOutputBytes - current.length); if (chunk.length > available) truncated = true; return Buffer.concat([current, chunk.subarray(0, available)]); };
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, limits.timeoutMs);
    child.on("error", () => { clearTimeout(timer); reject(new EvidenceGatewayError("REPRODUCTION_FAILED")); });
    child.on("close", (code) => { clearTimeout(timer); if (timedOut) reject(new EvidenceGatewayError("REPRODUCTION_TIMEOUT")); else resolveResult({ exitCode: code ?? -1, stdout: stdout.toString(), stderr: stderr.toString(), truncated }); });
  });
}
