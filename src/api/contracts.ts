import { z } from "zod";

export const createIncidentRequestSchema = z.object({
  projectId: z.string().min(1), service: z.string().min(1).max(100),
  mode: z.enum(["AUTO_RESOLVE", "PR_APPROVAL", "INVESTIGATE_ONLY"]).default("PR_APPROVAL"),
  severity: z.enum(["SEV1", "SEV2", "SEV3"]).default("SEV2"),
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export const approvalRequestSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]), actor: z.string().min(1).max(200), notes: z.string().max(2000).optional(),
});
export const projectRequestSchema = z.object({
  name:z.string().min(1), owner:z.string().min(1), repo:z.string().min(3), defaultBranch:z.string().default("main"),
  productionUrl:z.string().url(), cloudflareProject:z.string().min(1),
  defaultMode:z.enum(["AUTO_RESOLVE","PR_APPROVAL","INVESTIGATE_ONLY"]).default("PR_APPROVAL"),
  baselineLatencyMs:z.number().positive().default(500), guardrails:z.record(z.unknown()), verificationConfig:z.record(z.unknown()),
});
export const evalRunRequestSchema = z.object({
  evalCaseName:z.string().min(1).max(200).optional(),
  suiteName:z.string().min(1).max(200).default("ci-release-gate"),
  target:z.string().min(1).max(300),
  trigger:z.enum(["pull_request","production_failure","manual","release"]).default("manual"),
  promptVersion:z.string().min(1).max(200).default("prompt@working-tree"),
  agentVersion:z.string().min(1).max(200).default("agent@working-tree"),
  score:z.number().min(0).max(100),
  threshold:z.number().min(0).max(100).default(94),
  durationMs:z.number().nonnegative().default(0),
  costUsd:z.number().nonnegative().default(0),
  releaseId:z.string().min(1).max(200).optional(),
  pullRequest:z.string().min(1).max(100).optional(),
  branch:z.string().min(1).max(200).optional(),
  commitSha:z.string().min(7).max(80).optional(),
  checkedAt:z.number().positive().optional(),
  failureMode:z.string().min(1).max(500).optional(),
  expectedCause:z.string().min(1).max(1000).optional(),
  allowedFiles:z.array(z.string().min(1).max(300)).optional(),
  expectedAssertions:z.array(z.string().min(1).max(500)).optional(),
  invariantResults:z.unknown().optional(),
  failureSourceId:z.string().min(1).max(200).optional(),
  failureSummary:z.string().min(1).max(1000).optional(),
  idempotencyKey:z.string().min(1).max(250).optional(),
  metadata:z.unknown().optional(),
});
export function parseCreateIncidentRequest(value:unknown){const x=createIncidentRequestSchema.parse(value);return {...x,source:"dashboard" as const,configuredMode:x.mode,idempotencyKey:x.idempotencyKey??crypto.randomUUID()}}
export function parseApprovalRequest(value:unknown){return approvalRequestSchema.parse(value)}
export function parseProjectRequest(value:unknown){return projectRequestSchema.parse(value)}
export function parseEvalRunRequest(value:unknown){return evalRunRequestSchema.parse(value)}
export function jsonResponse(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","access-control-allow-origin":"*","access-control-allow-headers":"content-type, authorization","access-control-allow-methods":"GET, POST, OPTIONS"}})}
