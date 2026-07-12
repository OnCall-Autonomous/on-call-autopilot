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
export function parseCreateIncidentRequest(value:unknown){const x=createIncidentRequestSchema.parse(value);return {...x,source:"dashboard" as const,configuredMode:x.mode,idempotencyKey:x.idempotencyKey??crypto.randomUUID()}}
export function parseApprovalRequest(value:unknown){return approvalRequestSchema.parse(value)}
export function parseProjectRequest(value:unknown){return projectRequestSchema.parse(value)}
export function publicErrorMessage(error:unknown){const message=error instanceof Error?error.message:"INVALID_REQUEST";return message.includes("IDEMPOTENCY_KEY_PAYLOAD_CONFLICT")?"IDEMPOTENCY_KEY_PAYLOAD_CONFLICT":message}
export function jsonResponse(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","access-control-allow-origin":"*","access-control-allow-headers":"content-type, authorization","access-control-allow-methods":"GET, POST, OPTIONS"}})}
