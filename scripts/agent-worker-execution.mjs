import { isAbsolute } from "node:path";

const SCAN_KIND = "SKILL_SECURITY_SCAN";
const MAX_ISSUES = 20;
const MAX_TEXT_CHARS = 300;

function workerError(code, message, durationMs = 0) {
  return Object.assign(new Error(message), { code, durationMs });
}

function invalidPayload(message) {
  throw workerError("WORKER_EXECUTION_PAYLOAD_INVALID", `WORKER_EXECUTION_PAYLOAD_INVALID: ${message}`);
}

export function classifyWorkerExecution(run) {
  const summary = run?.inputSummary;
  if (typeof summary !== "string") invalidPayload("inputSummary must be a string");

  const trimmed = summary.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { kind: "HERMES" };

  let payload;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    invalidPayload("structured inputSummary must be valid JSON");
  }
  if (!payload || Array.isArray(payload) || typeof payload !== "object") invalidPayload("payload must be an object");
  if (payload.kind !== SCAN_KIND) invalidPayload("unknown execution kind");
  if (Object.keys(payload).sort().join(",") !== "kind,targetPath") invalidPayload("scan payload fields are invalid");
  if (typeof payload.targetPath !== "string" || payload.targetPath.length === 0) invalidPayload("targetPath must be a non-empty string");
  if (run.agent !== "TEMP_SPECIALIST") {
    throw workerError("WORKER_EXECUTION_NOT_AUTHORIZED", "WORKER_EXECUTION_NOT_AUTHORIZED: only TEMP_SPECIALIST may request a skill security scan");
  }
  return { kind: SCAN_KIND, targetPath: payload.targetPath };
}

function scanConfiguration(env) {
  const allowedRoot = env.SKILL_SECURITY_ALLOWED_ROOT;
  const executablePath = env.SKILL_SECURITY_EXECUTABLE;
  if (!isAbsolute(allowedRoot ?? "") || !isAbsolute(executablePath ?? "")) {
    throw workerError("SKILL_SECURITY_SCAN_CONFIGURATION_ERROR", "Skill security scan configuration is missing or invalid");
  }
  return { allowedRoot, executablePath };
}

function boundedText(value) {
  return String(value ?? "").slice(0, MAX_TEXT_CHARS);
}

function persistenceSummary(result) {
  const decision = result.decision;
  const issues = Array.isArray(result.issues) ? result.issues.slice(0, MAX_ISSUES).map((issue) => ({
    severity: boundedText(issue.severity),
    title: boundedText(issue.title),
    path: boundedText(issue.path),
    startLine: issue.startLine,
  })) : [];
  return {
    decision,
    installable: decision === "ALLOW" && result.installable === true,
    recommendation: result.recommendation,
    score: result.score,
    counts: result.counts,
    issues,
    contentDigest: result.contentDigest,
    scannerVersion: result.scannerVersion,
    policyVersion: result.policyVersion,
    fileCount: result.fileCount,
    totalBytes: result.totalBytes,
    durationMs: result.durationMs,
  };
}

export async function executeWorkerRun(run, dependencies) {
  const execution = classifyWorkerExecution(run);
  if (execution.kind === "HERMES") return await dependencies.runHermes(run);

  const config = scanConfiguration(dependencies.env);
  const result = await dependencies.scanSkillSecurity({ targetPath: execution.targetPath, ...config });
  if (result.decision === "SCAN_ERROR") {
    throw workerError("SKILL_SECURITY_SCAN_FAILED", "Skill security scan failed", Number(result.durationMs || 0));
  }
  return { output: JSON.stringify(persistenceSummary(result)), durationMs: Number(result.durationMs || 0) };
}
