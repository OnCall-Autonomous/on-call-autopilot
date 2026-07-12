import path from "node:path";

export interface CommandRequest {
  executable: string;
  args: string[];
  cwd?: string;
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}

export interface GatewayLimits {
  allowedRepo: string;
  allowedReadPaths: string[];
  allowedWritePaths: string[];
  protectedPaths: string[];
  maxChangedFiles: number;
  maxChangedLines: number;
  maxCommandMs: number;
  maxOutputBytes: number;
}

export interface TestCommand {
  executable: "npm" | "pnpm" | "yarn" | "bun";
  args: string[];
}

export interface InvestigationRequest {
  repo: string;
  issueNumber: number;
  ref: string;
  readPaths: string[];
  search: { query: string; path: string };
  reproduction: TestCommand;
}

export interface PatchDeliveryRequest {
  repo: string;
  baseRef: string;
  branch: string;
  patch: string;
  regressionTestPaths: string[];
  targetedTest: TestCommand;
  fullTest: TestCommand;
  commitMessage: string;
  prTitle: string;
  prBody: string;
}

interface ChangedFile {
  path: string;
  added: number;
  deleted: number;
}

const SAFE_REF = /^(?:[0-9a-f]{40}|[A-Za-z0-9][A-Za-z0-9._/-]{0,199})$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const SAFE_BRANCH = /^(fix|feat)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/;
const TEST_PATH = /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/;

export class GitHubGateway {
  constructor(
    private readonly runner: CommandRunner,
    private readonly limits: GatewayLimits,
    private readonly checkoutPath: string,
  ) {}

  async investigate(request: InvestigationRequest) {
    this.assertRepository(request.repo);
    if (!Number.isSafeInteger(request.issueNumber) || request.issueNumber <= 0) throw new Error("INVALID_ISSUE_NUMBER");
    const issue = await this.run("gh", ["api", `repos/${request.repo}/issues/${request.issueNumber}`]);
    const ci = await this.run("gh", ["api", `repos/${request.repo}/commits/${request.ref}/status`]);
    const files: Record<string, CommandResult> = {};
    for (const filePath of request.readPaths) {
      files[filePath] = await this.readFile(request.repo, request.ref, filePath);
    }
    const search = await this.searchRepository(request.repo, request.search.query, request.search.path);
    await this.createCheckout(request.repo, request.ref);
    const reproduction = await this.runReproduction(request.reproduction);
    return { issue, ci, files, search, checkoutPath: this.checkoutPath, reproduction };
  }

  async readFile(repo: string, ref: string, filePath: string): Promise<CommandResult> {
    this.assertRepository(repo);
    this.assertRef(ref);
    this.assertAllowedPath(filePath, this.limits.allowedReadPaths, "READ_PATH_NOT_ALLOWLISTED");
    return this.run("gh", ["api", "--method", "GET", `repos/${repo}/contents/${filePath}`, "-f", `ref=${ref}`, "-H", "Accept: application/vnd.github.raw+json"]);
  }

  async searchRepository(repo: string, query: string, searchPath: string): Promise<CommandResult> {
    this.assertRepository(repo);
    this.assertAllowedPath(searchPath, this.limits.allowedReadPaths, "READ_PATH_NOT_ALLOWLISTED");
    if (!query.trim() || query.length > 200) throw new Error("INVALID_SEARCH_QUERY");
    return this.run("gh", ["api", "--method", "GET", "search/code", "-f", `q=${query} repo:${repo} path:${searchPath}`]);
  }

  async createCheckout(repo: string, ref: string): Promise<void> {
    this.assertRepository(repo);
    this.assertRef(ref);
    await this.requireSuccess("CHECKOUT_FAILED", "git", ["clone", "--filter=blob:none", "--no-checkout", `https://github.com/${repo}.git`, this.checkoutPath]);
    await this.requireSuccess("CHECKOUT_FAILED", "git", ["checkout", "--detach", ref], this.checkoutPath);
  }

  async runReproduction(command: TestCommand | { executable: string; args: string[] }): Promise<CommandResult> {
    this.assertTestCommand(command);
    return this.run(command.executable, command.args, this.checkoutPath);
  }

  async deliverPatch(request: PatchDeliveryRequest) {
    this.assertRepository(request.repo);
    this.assertRef(request.baseRef);
    if (!SAFE_BRANCH.test(request.branch)) throw new Error("INVALID_FEATURE_BRANCH");
    if (request.patch.length > this.limits.maxOutputBytes * 5) throw new Error("PATCH_TOO_LARGE");
    this.assertTestCommand(request.targetedTest);
    this.assertTestCommand(request.fullTest);

    await this.requireSuccess("BRANCH_CREATE_FAILED", "git", ["switch", "-c", request.branch, request.baseRef], this.checkoutPath);
    await this.requireSuccess("PATCH_APPLY_FAILED", "git", ["apply", "--index", "--whitespace=error", "-"], this.checkoutPath, request.patch);

    const changedFilesResult = await this.requireSuccess("DIFF_INSPECTION_FAILED", "git", ["diff", "--cached", "--name-only", "--diff-filter=ACMRD"], this.checkoutPath);
    const numstatResult = await this.requireSuccess("DIFF_INSPECTION_FAILED", "git", ["diff", "--cached", "--numstat", "--diff-filter=ACMRD"], this.checkoutPath);
    const changedFiles = this.parseChangedFiles(changedFilesResult.stdout, numstatResult.stdout);
    this.assertPatchScope(changedFiles, request.regressionTestPaths);

    await this.requireSuccess("TARGETED_TEST_FAILED", request.targetedTest.executable, request.targetedTest.args, this.checkoutPath);
    await this.requireSuccess("FULL_TEST_FAILED", request.fullTest.executable, request.fullTest.args, this.checkoutPath);
    await this.requireSuccess("COMMIT_FAILED", "git", ["commit", "-m", request.commitMessage], this.checkoutPath);
    const localSha = (await this.requireSuccess("LOCAL_SHA_FAILED", "git", ["rev-parse", "HEAD"], this.checkoutPath)).stdout.trim();
    if (!FULL_SHA.test(localSha)) throw new Error("INVALID_LOCAL_SHA");
    await this.requireSuccess("PUSH_FAILED", "git", ["push", "--set-upstream", "origin", request.branch], this.checkoutPath);
    const remoteSha = (await this.requireSuccess("REMOTE_SHA_FAILED", "git", ["ls-remote", "--heads", "origin", request.branch], this.checkoutPath)).stdout.trim().split(/\s+/)[0];
    if (!FULL_SHA.test(remoteSha) || remoteSha !== localSha) throw new Error("REMOTE_SHA_MISMATCH");

    const pullRequestUrl = (await this.requireSuccess("PR_CREATE_FAILED", "gh", ["pr", "create", "--repo", request.repo, "--base", request.baseRef, "--head", request.branch, "--title", request.prTitle, "--body", request.prBody], this.checkoutPath)).stdout.trim();
    const pr = await this.requireSuccess("PR_VERIFY_FAILED", "gh", ["pr", "view", pullRequestUrl, "--repo", request.repo, "--json", "url,headRefOid"], this.checkoutPath);
    const verified = JSON.parse(pr.stdout) as { url?: string; headRefOid?: string };
    if (verified.url !== pullRequestUrl || verified.headRefOid !== localSha) throw new Error("PR_VERIFICATION_FAILED");
    return { branch: request.branch, commitSha: localSha, remoteSha, pullRequestUrl };
  }

  private parseChangedFiles(names: string, numstat: string): ChangedFile[] {
    const stats = new Map<string, { added: number; deleted: number }>();
    for (const line of numstat.trim().split("\n").filter(Boolean)) {
      const [added, deleted, filePath] = line.split("\t");
      if (!filePath || added === "-" || deleted === "-") throw new Error("BINARY_PATCH_FORBIDDEN");
      stats.set(filePath, { added: Number(added), deleted: Number(deleted) });
    }
    return names.trim().split("\n").filter(Boolean).map((filePath) => ({ path: filePath, ...(stats.get(filePath) ?? { added: 0, deleted: 0 }) }));
  }

  private assertPatchScope(files: ChangedFile[], regressionTestPaths: string[]): void {
    if (files.length === 0) throw new Error("EMPTY_PATCH");
    if (files.length > this.limits.maxChangedFiles) throw new Error("CHANGED_FILE_LIMIT");
    const changedLines = files.reduce((total, file) => total + file.added + file.deleted, 0);
    if (changedLines > this.limits.maxChangedLines) throw new Error("CHANGED_LINE_LIMIT");
    for (const file of files) {
      if (this.pathMatches(file.path, this.limits.protectedPaths)) throw new Error(`PROTECTED_PATH:${file.path}`);
      this.assertAllowedPath(file.path, this.limits.allowedWritePaths, "WRITE_PATH_NOT_ALLOWLISTED");
    }
    const changedPaths = new Set(files.map((file) => file.path));
    const hasRegressionTest = regressionTestPaths.some((testPath) => TEST_PATH.test(testPath) && changedPaths.has(testPath));
    if (!hasRegressionTest) throw new Error("REGRESSION_TEST_REQUIRED");
  }

  private assertRepository(repo: string): void {
    if (repo !== this.limits.allowedRepo) throw new Error("REPO_NOT_ALLOWLISTED");
  }

  private assertRef(ref: string): void {
    if (!SAFE_REF.test(ref) || ref.includes("..") || ref.includes("//")) throw new Error("INVALID_GIT_REF");
  }

  private assertTestCommand(command: { executable: string; args: string[] }): asserts command is TestCommand {
    if (!(["npm", "pnpm", "yarn", "bun"] as string[]).includes(command.executable)) throw new Error("REPRODUCTION_COMMAND_NOT_ALLOWLISTED");
    if (command.args.length === 0 || command.args.length > 20 || command.args.some((arg) => arg.length > 300 || /[\n\r\0]/.test(arg))) throw new Error("INVALID_COMMAND_ARGUMENTS");
  }

  private assertAllowedPath(filePath: string, allowed: string[], error: string): void {
    const normalized = path.posix.normalize(filePath);
    if (normalized !== filePath || normalized.startsWith("../") || path.posix.isAbsolute(normalized) || !this.pathMatches(normalized, allowed)) throw new Error(error);
  }

  private pathMatches(filePath: string, prefixes: string[]): boolean {
    return prefixes.some((prefix) => filePath === prefix || filePath.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
  }

  private run(executable: string, args: string[], cwd?: string, stdin?: string): Promise<CommandResult> {
    return this.runner.run({ executable, args, cwd, stdin, timeoutMs: this.limits.maxCommandMs, maxOutputBytes: this.limits.maxOutputBytes });
  }

  private async requireSuccess(error: string, executable: string, args: string[], cwd?: string, stdin?: string): Promise<CommandResult> {
    const result = await this.run(executable, args, cwd, stdin);
    if (result.exitCode !== 0) throw new Error(`${error}:${result.stderr || result.stdout}`);
    return result;
  }
}
