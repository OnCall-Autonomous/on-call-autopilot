import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { spawn } from "node:child_process";

export const SKILL_SECURITY_POLICY_VERSION = "1";
const SUPPORTED_SCANNER_VERSION = /^1\./;
const ARCHIVE_EXTENSIONS = /\.(?:zip|tar|tgz|gz|bz2|xz|7z|rar)$/i;

export interface SkillSecurityLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  maxPathBytes: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxReportBytes: number;
  maxIssueSummaries: number;
  maxIssueTextChars: number;
  timeoutMs: number;
}

export const DEFAULT_SKILL_SECURITY_LIMITS: Readonly<SkillSecurityLimits> = Object.freeze({
  maxFiles: 1_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxDepth: 20,
  maxPathBytes: 1_024,
  maxStdoutBytes: 2 * 1024 * 1024,
  maxStderrBytes: 256 * 1024,
  maxReportBytes: 2 * 1024 * 1024,
  maxIssueSummaries: 20,
  maxIssueTextChars: 300,
  timeoutMs: 60_000,
});

export type SkillSecurityDecision = "ALLOW" | "REQUIRE_APPROVAL" | "BLOCK" | "SCAN_ERROR";
export type ScannerRecommendation = "SAFE" | "CAUTION" | "DO_NOT_INSTALL";

export interface SkillSecurityIssue {
  severity: string;
  title: string;
  path: string;
  startLine: number;
}

export interface SkillSecurityVerdict {
  decision: Exclude<SkillSecurityDecision, "SCAN_ERROR">;
  installable: boolean;
  recommendation: ScannerRecommendation;
  score: number;
  counts: { critical: number; high: number; medium: number; low: number };
  issues: SkillSecurityIssue[];
}

export interface SkillSecurityResult extends Partial<Omit<SkillSecurityVerdict, "decision" | "installable">> {
  decision: SkillSecurityDecision;
  installable: boolean;
  policyVersion: string;
  scannerVersion?: string;
  contentDigest?: string;
  fileCount?: number;
  totalBytes?: number;
  durationMs: number;
  error?: { code: string; message: string };
}

export interface SkillSecurityRequest {
  targetPath: string;
  allowedRoot: string;
  executablePath: string;
  limits?: Partial<SkillSecurityLimits>;
}

export interface RunnerRequest {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  stdoutCapBytes: number;
  stderrCapBytes: number;
  sandbox: { network: false; readOnlyInput: true; inputPath: string; outputPath: string; profile: string };
}

export interface RunnerResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  report?: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

export type ProcessRunner = (request: RunnerRequest) => Promise<RunnerResult>;

class ScanFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ScanFailure("INVALID_REPORT", `${label} must be an object`);
  return value as Record<string, unknown>;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string") throw new ScanFailure("INVALID_REPORT", `${label} must be a string`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ScanFailure("INVALID_REPORT", `${label} must be a finite number`);
  return value;
}

function count(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number) || number < 0) throw new ScanFailure("INVALID_REPORT", `${label} must be a non-negative integer`);
  return number;
}

function redactAndBound(value: string, max: number): string {
  const redacted = value
    .replace(/(?:\/[\w .@+-]+){2,}/g, "[redacted-path]")
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\s]*/g, "[redacted-path]");
  return redacted.slice(0, max);
}

export function parseSkillSpectorReport(json: string, limits: Pick<SkillSecurityLimits, "maxIssueSummaries" | "maxIssueTextChars"> = DEFAULT_SKILL_SECURITY_LIMITS): SkillSecurityVerdict {
  let decoded: unknown;
  try { decoded = JSON.parse(json); } catch { throw new ScanFailure("INVALID_REPORT", "scanner report is not valid JSON"); }
  const report = object(decoded, "report");
  stringField(report.skill, "skill");
  const risk = object(report.risk_assessment, "risk_assessment");
  const recommendation = stringField(risk.recommendation, "risk_assessment.recommendation");
  if (recommendation !== "SAFE" && recommendation !== "CAUTION" && recommendation !== "DO_NOT_INSTALL") throw new ScanFailure("INVALID_REPORT", "unsupported recommendation");
  const score = finiteNumber(risk.score, "risk_assessment.score");
  if (score < 0 || score > 100) throw new ScanFailure("INVALID_REPORT", "score must be between 0 and 100");
  const severity = stringField(risk.severity, "risk_assessment.severity");
  const expected: Record<ScannerRecommendation, readonly string[]> = { SAFE: ["LOW"], CAUTION: ["MEDIUM"], DO_NOT_INSTALL: ["HIGH", "CRITICAL"] };
  if (!expected[recommendation].includes(severity)) throw new ScanFailure("INVALID_REPORT", "risk severity contradicts recommendation");
  if (!Array.isArray(report.issues)) throw new ScanFailure("INVALID_REPORT", "issues must be an array");
  const metadata = object(report.metadata, "metadata");
  stringField(metadata.skillspector_version, "metadata.skillspector_version");
  if (metadata.llm_requested !== false) throw new ScanFailure("INVALID_REPORT", "static report must have llm_requested=false");
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  const validated = report.issues.map((raw, index) => {
    const issue = object(raw, `issues[${index}]`);
    const issueSeverity = stringField(issue.severity, `issues[${index}].severity`);
    if (issueSeverity !== "CRITICAL" && issueSeverity !== "HIGH" && issueSeverity !== "MEDIUM" && issueSeverity !== "LOW") throw new ScanFailure("INVALID_REPORT", "unsupported issue severity");
    counts[issueSeverity.toLowerCase() as keyof typeof counts] += 1;
    finiteNumber(issue.confidence, `issues[${index}].confidence`);
    const location = object(issue.location, `issues[${index}].location`);
    const startLine = finiteNumber(location.start_line, `issues[${index}].location.start_line`);
    if (!Number.isInteger(startLine) || startLine < 1) throw new ScanFailure("INVALID_REPORT", "issue start_line must be a positive integer");
    const category = stringField(issue.category, `issues[${index}].category`);
    const id = stringField(issue.id, `issues[${index}].id`);
    return {
      severity: issueSeverity,
      title: redactAndBound(`${category} (${id})`, limits.maxIssueTextChars),
      path: redactAndBound(stringField(location.file, `issues[${index}].location.file`), limits.maxIssueTextChars),
      startLine,
    };
  });
  const decision = recommendation === "SAFE" ? "ALLOW" : recommendation === "CAUTION" ? "REQUIRE_APPROVAL" : "BLOCK";
  return { decision, installable: decision === "ALLOW", recommendation, score, counts, issues: validated.slice(0, limits.maxIssueSummaries) };
}

function contained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function validatePaths(request: SkillSecurityRequest): Promise<{ root: string; target: string; executable: string }> {
  if (!isAbsolute(request.allowedRoot) || !isAbsolute(request.targetPath)) throw new ScanFailure("INVALID_PATH", "root and target must be absolute paths");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(request.targetPath) || ARCHIVE_EXTENSIONS.test(request.targetPath)) throw new ScanFailure("INVALID_PATH", "URLs and archives are not supported");
  if (!isAbsolute(request.executablePath)) throw new ScanFailure("INVALID_EXECUTABLE", "scanner executable must be an absolute path");
  const root = await realpath(request.allowedRoot);
  const target = await realpath(request.targetPath);
  if (!contained(root, target) || target === root) throw new ScanFailure("INVALID_PATH", "target must be a child of the allowed root");
  const targetStat = await lstat(target);
  if (!targetStat.isDirectory()) throw new ScanFailure("INVALID_PATH", "target must be a directory");
  const executable = await realpath(request.executablePath);
  const executableStat = await lstat(executable);
  if (!executableStat.isFile()) throw new ScanFailure("INVALID_EXECUTABLE", "scanner executable must be a regular file");
  await access(executable, constants.X_OK);
  return { root, target, executable };
}

interface StageResult { path: string; digest: string; fileCount: number; totalBytes: number }

async function stageTarget(source: string, workspace: string, limits: SkillSecurityLimits): Promise<StageResult> {
  const destination = join(workspace, "input");
  await mkdir(destination, { mode: 0o700 });
  const hash = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;

  async function visit(directory: string, relativeDirectory: string, depth: number): Promise<void> {
    if (depth > limits.maxDepth) throw new ScanFailure("LIMIT_EXCEEDED", "directory depth limit exceeded");
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name;
      if (Buffer.byteLength(relativePath) > limits.maxPathBytes) throw new ScanFailure("LIMIT_EXCEEDED", "path length limit exceeded");
      const sourcePath = join(directory, entry.name);
      const metadata = await lstat(sourcePath);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) throw new ScanFailure("UNSUPPORTED_FILE", "links and special files are not supported");
      if (metadata.isDirectory()) {
        await mkdir(join(destination, relativePath), { mode: 0o500 });
        await visit(sourcePath, relativePath, depth + 1);
        continue;
      }
      if (metadata.nlink !== 1) throw new ScanFailure("UNSUPPORTED_FILE", "hard-linked files are not supported");
      fileCount += 1;
      totalBytes += metadata.size;
      if (fileCount > limits.maxFiles || metadata.size > limits.maxFileBytes || totalBytes > limits.maxTotalBytes) throw new ScanFailure("LIMIT_EXCEEDED", "staging resource limit exceeded");
      const data = await readFile(sourcePath);
      hash.update(Buffer.from(relativePath)); hash.update("\0"); hash.update(data); hash.update("\0");
      const destinationPath = join(destination, relativePath);
      await writeFile(destinationPath, data, { mode: 0o400, flag: "wx" });
    }
  }
  await visit(source, "", 0);
  await chmod(destination, 0o500);
  return { path: destination, digest: `sha256:${hash.digest("hex")}`, fileCount, totalBytes };
}

function minimalEnvironment(home: string): Record<string, string> {
  return { HOME: home, XDG_CACHE_HOME: join(home, ".cache"), TMPDIR: join(home, "tmp"), PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
}

function cappedCollector(cap: number): { append(chunk: Buffer): void; text(): string; truncated(): boolean } {
  const chunks: Buffer[] = []; let size = 0; let overflow = false;
  return {
    append(chunk) { if (size >= cap) { overflow = true; return; } const accepted = chunk.subarray(0, cap - size); chunks.push(accepted); size += accepted.length; if (accepted.length < chunk.length) overflow = true; },
    text: () => Buffer.concat(chunks).toString("utf8"),
    truncated: () => overflow,
  };
}

function buildSandboxProfile(inputPath: string, outputPath: string, executable: string): string {
  const quote = (path: string) => path.replaceAll('"', '\\"');
  return [
    "(version 1)", "(deny default)", "(allow process*)", "(deny network*)",
    `(allow file-read* (subpath "${quote(inputPath)}"))`,
    `(allow file-read* (literal "${quote(executable)}"))`,
    '(allow file-read* (subpath "/usr"))', '(allow file-read* (subpath "/bin"))',
    '(allow file-read* (subpath "/System/Library"))',
    `(allow file-write* (subpath "${quote(outputPath)}"))`,
  ].join("\n");
}

export const runSkillSpectorProcess: ProcessRunner = async (request) => {
  const stdout = cappedCollector(request.stdoutCapBytes); const stderr = cappedCollector(request.stderrCapBytes);
  const useSandbox = process.platform === "darwin";
  const executable = useSandbox ? "/usr/bin/sandbox-exec" : request.executable;
  const args = useSandbox ? ["-p", request.sandbox.profile, request.executable, ...request.args] : request.args;
  return await new Promise<RunnerResult>((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd: request.cwd, env: request.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
    child.on("error", reject);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); } }, request.timeoutMs);
    child.on("close", (exitCode, signal) => { clearTimeout(timer); resolvePromise({ exitCode, signal, timedOut, stdout: stdout.text(), stderr: stderr.text(), stdoutTruncated: stdout.truncated(), stderrTruncated: stderr.truncated() }); });
  });
};

function scanError(start: number, error: unknown): SkillSecurityResult {
  const failure = error instanceof ScanFailure ? error : new ScanFailure("SCAN_FAILED", error instanceof Error ? error.message : "unknown scanner failure");
  return { decision: "SCAN_ERROR", installable: false, policyVersion: SKILL_SECURITY_POLICY_VERSION, durationMs: Date.now() - start, error: { code: failure.code, message: redactAndBound(failure.message, 300) } };
}

export async function scanSkillSecurity(request: SkillSecurityRequest, runner: ProcessRunner = runSkillSpectorProcess): Promise<SkillSecurityResult> {
  const start = Date.now();
  let workspace: string | undefined;
  try {
    const limits = { ...DEFAULT_SKILL_SECURITY_LIMITS, ...request.limits };
    const paths = await validatePaths(request);
    workspace = await mkdtemp(join(tmpdir(), "skill-security-"));
    const home = join(workspace, "home"); const output = join(workspace, "output");
    await mkdir(join(home, ".cache"), { recursive: true, mode: 0o700 }); await mkdir(join(home, "tmp"), { mode: 0o700 }); await mkdir(output, { mode: 0o700 });
    const staged = await stageTarget(paths.target, workspace, limits);
    const env = minimalEnvironment(home);
    const baseRequest = { executable: paths.executable, cwd: workspace, env, timeoutMs: limits.timeoutMs, stdoutCapBytes: limits.maxStdoutBytes, stderrCapBytes: limits.maxStderrBytes, sandbox: { network: false as const, readOnlyInput: true as const, inputPath: staged.path, outputPath: output, profile: buildSandboxProfile(staged.path, output, paths.executable) } };
    const versionResult = await runner({ ...baseRequest, args: ["--version"] });
    if (versionResult.timedOut || versionResult.signal || versionResult.exitCode !== 0 || versionResult.stdoutTruncated || versionResult.stderrTruncated) throw new ScanFailure("VERSION_PROBE_FAILED", "scanner version probe failed");
    const versionMatch = versionResult.stdout.match(/(?:SkillSpector\s+)?(\d+\.\d+\.\d+)/i);
    if (!versionMatch || !SUPPORTED_SCANNER_VERSION.test(versionMatch[1])) throw new ScanFailure("UNSUPPORTED_VERSION", "unsupported scanner version");
    const reportPath = join(output, "report.json");
    const outcome = await runner({ ...baseRequest, args: ["scan", staged.path, "--no-llm", "--format", "json", "--output", reportPath] });
    if (outcome.timedOut) throw new ScanFailure("TIMEOUT", "scanner timed out");
    if (outcome.signal || (outcome.exitCode !== 0 && outcome.exitCode !== 1)) throw new ScanFailure("PROCESS_FAILED", "scanner process failed");
    if (outcome.stdoutTruncated || outcome.stderrTruncated || Buffer.byteLength(outcome.stdout) > limits.maxStdoutBytes || Buffer.byteLength(outcome.stderr) > limits.maxStderrBytes) throw new ScanFailure("OUTPUT_LIMIT", "scanner diagnostic output exceeded limit");
    let reportBody: string;
    if (outcome.report !== undefined) reportBody = outcome.report;
    else {
      let metadata;
      try { metadata = await stat(reportPath); } catch { throw new ScanFailure("MISSING_REPORT", "scanner did not produce the required private report"); }
      if (!metadata.isFile()) throw new ScanFailure("MISSING_REPORT", "scanner report is not a regular file");
      if (metadata.size > limits.maxReportBytes) throw new ScanFailure("REPORT_LIMIT", "scanner report exceeded limit");
      reportBody = await readFile(reportPath, "utf8");
    }
    if (Buffer.byteLength(reportBody) > limits.maxReportBytes) throw new ScanFailure("REPORT_LIMIT", "scanner report exceeded limit");
    const verdict = parseSkillSpectorReport(reportBody, limits);
    const reportVersion = stringField(object(object(JSON.parse(reportBody), "report").metadata, "metadata").skillspector_version, "metadata.skillspector_version");
    if (reportVersion !== versionMatch[1]) throw new ScanFailure("VERSION_MISMATCH", "report scanner version differs from version probe");
    return { ...verdict, scannerVersion: versionMatch[1], policyVersion: SKILL_SECURITY_POLICY_VERSION, contentDigest: staged.digest, fileCount: staged.fileCount, totalBytes: staged.totalBytes, durationMs: Date.now() - start };
  } catch (error) {
    return scanError(start, error);
  } finally {
    if (workspace) {
      await chmod(join(workspace, "input"), 0o700).catch(() => undefined);
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
