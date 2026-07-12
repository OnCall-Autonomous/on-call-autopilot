# On-Call Autopilot — UI Integration Specification

Repository: https://github.com/OnCall-Autonomous/on-call-autopilot

Backend sources: `convex/http.ts`, `convex/schema.ts`, `src/api/contracts.ts`.

## 1. Base URLs

After deployment, Convex provides:

```env
# Real-time Convex queries/subscriptions
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
# HTTP API
NEXT_PUBLIC_API_URL=https://<deployment>.convex.site
```

For Vite, use `VITE_CONVEX_URL` and `VITE_API_URL` instead. All HTTP paths below are relative to the `.convex.site` URL.

Authentication is intentionally deferred. Current CORS headers allow all origins, `content-type` and `authorization`, and `GET`, `POST`, and `OPTIONS`. Do not treat this as production-ready security.

## 2. Common Conventions

Successful object/list responses:

```json
{"data": {}}
```

```json
{"data": []}
```

Error response:

```json
{"error": "ERROR_MESSAGE"}
```

All payloads use `application/json`. Convex IDs are opaque strings; never parse them or convert them to numbers. Timestamps are Unix epoch milliseconds. Every Convex document also includes:

```ts
interface ConvexSystemFields {
  _id: string;
  _creationTime: number;
}
```

## 3. Shared Enumerations

```ts
type IncidentMode = "AUTO_RESOLVE" | "PR_APPROVAL" | "INVESTIGATE_ONLY";
type IncidentSeverity = "SEV1" | "SEV2" | "SEV3";
type IncidentSource = "voice" | "telegram" | "auto_detect" | "dashboard" | "webhook";
type IncidentStatus =
  | "DETECTED" | "PLANNING" | "DIAGNOSING" | "DIAGNOSIS_REVIEW"
  | "PATCHING" | "PATCH_REVIEW" | "PR_READY" | "AWAITING_APPROVAL"
  | "DEPLOYING" | "VERIFYING" | "PERF_CHECK" | "ASSIGNEE_SELECTION"
  | "HANDOFF_READY" | "RETRYING" | "ROLLING_BACK" | "RESOLVED" | "ESCALATED";
type AgentName =
  | "COMMANDER" | "DIAGNOSER" | "FIXER" | "VERIFIER"
  | "PERFORMANCE" | "REPORTER" | "TEMP_SPECIALIST";
type AgentRunStatus = "queued" | "running" | "succeeded" | "failed";
type PerformanceVerdict = "PASS" | "REGRESSION" | "WAIVED";
type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
```

Terminal incident states are `RESOLVED` and `ESCALATED`. `effectiveMode` may be less autonomous than `configuredMode`; display both when they differ.

## 4. HTTP API

### `GET /api/health`

Response `200`:

```json
{"ok": true, "service": "on-call-autopilot", "timestamp": 1783840000000}
```

### `GET /api/projects`

Returns all guarded projects:

```json
{"data": [{"_id":"project_id","_creationTime":1783840000000,"name":"Checkout Demo","owner":"OnCall-Autonomous","repo":"OnCall-Autonomous/checkout-demo","defaultBranch":"main","productionUrl":"https://checkout-demo.workers.dev","cloudflareProject":"checkout-demo","defaultMode":"PR_APPROVAL","guardrails":{},"verificationConfig":{},"baselineLatencyMs":500,"createdAt":1783840000000}]}
```

### `POST /api/projects`

Creates or updates a project using `repo` as the business key.

```json
{
  "name": "Checkout Demo",
  "owner": "OnCall-Autonomous",
  "repo": "OnCall-Autonomous/checkout-demo",
  "defaultBranch": "main",
  "productionUrl": "https://checkout-demo.workers.dev",
  "cloudflareProject": "checkout-demo",
  "defaultMode": "PR_APPROVAL",
  "baselineLatencyMs": 500,
  "guardrails": {
    "allowedRepos": ["OnCall-Autonomous/checkout-demo"],
    "allowedPaths": ["src"],
    "blockedPaths": ["migrations", ".github", "src/auth", "src/billing"],
    "maxChangedFiles": 3,
    "maxChangedLines": 80,
    "confidenceThreshold": 0.8,
    "maxCostUsd": 2,
    "maxRuntimeMs": 300000,
    "maxAttempts": 2,
    "performanceTolerancePct": 20
  },
  "verificationConfig": {
    "method": "POST",
    "path": "/checkout",
    "expectedStatus": 200,
    "requiredJsonPaths": ["orderId", "status"],
    "forbiddenErrorSignatures": ["Internal Server Error"],
    "checkFreshLogs": true
  }
}
```

Defaults: `defaultBranch="main"`, `defaultMode="PR_APPROVAL"`, `baselineLatencyMs=500`. Response `201`:

```json
{"data":{"id":"project_id"}}
```

### `GET /api/incidents?projectId=&limit=`

Returns newest incidents first. `projectId` is optional. `limit` defaults to 50 and is clamped to 1–100.

```json
{"data":[{"_id":"incident_id","projectId":"project_id","source":"dashboard","service":"checkout","severity":"SEV2","configuredMode":"AUTO_RESOLVE","effectiveMode":"AUTO_RESOLVE","status":"DIAGNOSING","startedAt":1783840000000,"awaitingApproval":false,"attempts":{"diagnosis":1,"patch":0,"verification":0},"deadlineAt":1783840300000,"budgetUsd":2,"idempotencyKey":"dashboard-request"}]}
```

### `POST /api/incidents`

```json
{
  "projectId": "project_id",
  "service": "checkout",
  "mode": "AUTO_RESOLVE",
  "severity": "SEV2",
  "idempotencyKey": "dashboard-fix-checkout-unique-id"
}
```

`mode` defaults to `PR_APPROVAL`; `severity` defaults to `SEV2`; `idempotencyKey` is generated if omitted. The idempotency key identifies one logical request: an exact replay must have the same `projectId`, source (`dashboard` for this HTTP route), `service`, `severity`, and configured mode. An exact replay returns the existing incident ID and creates no additional incident or initial `STATE_TRANSITION` event. Response `201` (for both first creation and exact replay):

```json
{"data":{"id":"incident_id"}}
```

Reusing the key when any compared value differs fails closed with response `400`; no incident or event is created:

```json
{"error":"IDEMPOTENCY_KEY_PAYLOAD_CONFLICT"}
```

Generate a new key for each logically different request. Retrying a request after a lost or uncertain response must reuse both the original key and the original payload.

### `GET /api/incidents/detail?incidentId=`

Primary hero-screen endpoint. Missing ID returns `400` with `{"error":"incidentId is required"}`. A missing incident returns `{"data":null}`. A found incident returns:

```json
{
  "data": {
    "incident": {},
    "project": {},
    "runs": [],
    "events": [],
    "deployments": [],
    "verifications": [],
    "performance": [],
    "approvals": []
  }
}
```

UI mapping: `incident` → header/status; `project` → repo/service links; `runs` → agent tree; `events` → timeline; `deployments`, `verifications`, `performance` → proof panel; `approvals` → action/history panel.

### `GET /api/overview?projectId=`

`projectId` is optional.

```json
{"data":{"projects":[],"metrics":{"total":8,"active":1,"resolved":6,"successRate":0.75,"mttrMs":92000},"activeIncidents":[]}}
```

`successRate` is 0–1. `activeIncidents` contains the newest 20 non-terminal incidents.

### `GET /api/approvals`

Returns only pending approvals:

```json
{"data":[{"_id":"approval_id","incidentId":"incident_id","type":"DEPLOY","status":"PENDING","requestedAt":1783840000000}]}
```

### `POST /api/approvals`

```json
{
  "incidentId": "incident_id",
  "decision": "APPROVED",
  "actor": "engineer@example.com",
  "notes": "Reviewed the minimal patch"
}
```

`decision` is `APPROVED` or `REJECTED`; actor is required (1–200 chars); notes are optional (max 2,000 chars). The incident must be `AWAITING_APPROVAL` and have a pending approval. Response:

```json
{"data":{"id":"approval_id"}}
```

Possible errors: `INCIDENT_NOT_FOUND`, `INCIDENT_NOT_AWAITING_APPROVAL`, `PENDING_APPROVAL_NOT_FOUND`.

### `GET /api/models`

```json
{"data":[{"_id":"profile_id","agent":"DIAGNOSER","kind":"llm","provider":"openrouter","model":"anthropic/claude-sonnet-4","temperature":0,"maxTokens":5000,"promptVersion":"diagnoser-v1","enabled":true,"updatedAt":1783840000000},{"_id":"profile_id_2","agent":"PERFORMANCE","kind":"deterministic","promptVersion":"performance-v1","enabled":true,"updatedAt":1783840000000}]}
```

Do not assume all agents use LLMs. Verifier and Performance are deterministic.

## 5. Frontend Types

```ts
export type ConvexId = string;
export type TimestampMs = number;
export interface ConvexSystemFields { _id: ConvexId; _creationTime: TimestampMs }

export interface Project extends ConvexSystemFields {
  name: string; owner: string; repo: string; defaultBranch: string;
  productionUrl: string; cloudflareProject: string; defaultMode: IncidentMode;
  guardrails: Record<string, unknown>; verificationConfig: Record<string, unknown>;
  baselineLatencyMs: number; createdAt: TimestampMs;
}

export interface Incident extends ConvexSystemFields {
  projectId: ConvexId; source: IncidentSource; service: string; severity: IncidentSeverity;
  configuredMode: IncidentMode; effectiveMode: IncidentMode; status: IncidentStatus;
  startedAt: TimestampMs; resolvedAt?: TimestampMs; rootCause?: string; confidence?: number;
  resolutionSummary?: string; awaitingApproval: boolean; approvedBy?: string;
  attempts: { diagnosis: number; patch: number; verification: number };
  deadlineAt: TimestampMs; budgetUsd: number; idempotencyKey: string;
}

export interface AgentRun extends ConvexSystemFields {
  incidentId: ConvexId; agent: AgentName | string; parentRunId?: ConvexId;
  status: AgentRunStatus; inputSummary: string; outputSummary?: string; model?: string;
  tokens?: number; cost?: number; durationMs?: number; startedAt: TimestampMs;
  finishedAt?: TimestampMs;
}

export interface IncidentEvent extends ConvexSystemFields {
  incidentId: ConvexId; runId?: ConvexId; type: string; tool?: string;
  status: string; timestamp: TimestampMs; metadata: Record<string, unknown>;
}

export interface Deployment extends ConvexSystemFields {
  incidentId: ConvexId; branch: string; commitSha: string; previewUrl?: string;
  productionUrl?: string; status: string; startedAt: TimestampMs; readyAt?: TimestampMs;
  externalDeploymentId: string;
}

export interface Verification extends ConvexSystemFields {
  incidentId: ConvexId; deploymentId: ConvexId;
  request: { method?: string; url?: string; path?: string; headers?: Record<string,string>; body?: unknown };
  responseStatus: number; latencyMs: number; assertions: Record<string,boolean>;
  passed: boolean; freshLogsClean: boolean; logsCheckedAt: TimestampMs; verifiedAt: TimestampMs;
}

export interface PerformanceRecord extends ConvexSystemFields {
  incidentId: ConvexId; deploymentId: ConvexId; baselineP95Ms: number;
  postFixP50Ms: number; postFixP95Ms: number; successRate: number; samples: number;
  verdict: PerformanceVerdict; note?: string; measuredAt: TimestampMs;
}

export interface Approval extends ConvexSystemFields {
  incidentId: ConvexId; type: "DEPLOY"; status: ApprovalStatus; requestedAt: TimestampMs;
  decidedAt?: TimestampMs; decisionBy?: string; notes?: string;
}

export interface ModelProfile extends ConvexSystemFields {
  agent: AgentName; kind: "llm" | "deterministic"; provider?: string; model?: string;
  temperature?: number; maxTokens?: number; promptVersion: string; enabled: boolean;
  updatedAt: TimestampMs;
}

export interface IncidentDetail {
  incident: Incident; project: Project | null; runs: AgentRun[]; events: IncidentEvent[];
  deployments: Deployment[]; verifications: Verification[];
  performance: PerformanceRecord[]; approvals: Approval[];
}
```

## 6. Database Schema

All tables also receive Convex `_id` and `_creationTime`.

### `projects`

`name`, `owner`, `repo`, `defaultBranch`, `productionUrl`, `cloudflareProject`, `defaultMode`, `guardrails`, `verificationConfig`, `baselineLatencyMs`, `createdAt`. Index: `by_repo(repo)`.

### `modelProfiles`

`agent`, `kind`, optional `provider`, optional `model`, optional `temperature`, optional `maxTokens`, `promptVersion`, `enabled`, `updatedAt`. Index: `by_agent(agent)`.

### `incidents`

`projectId`, `source`, `service`, `severity`, `configuredMode`, `effectiveMode`, `status`, `startedAt`, optional `resolvedAt`, optional `rootCause`, optional `confidence`, optional `resolutionSummary`, `awaitingApproval`, optional `approvedBy`, attempt counters, `deadlineAt`, `budgetUsd`, `idempotencyKey`. Indexes: `by_project_status(projectId,status)` and `by_idempotency(idempotencyKey)`.

### `agentRuns`

`incidentId`, `agent`, optional `parentRunId`, `status`, `inputSummary`, optional `outputSummary`, optional `model`, optional `tokens`, optional `cost`, optional `durationMs`, `startedAt`, optional `finishedAt`. Index: `by_incident(incidentId)`. Build the agent tree using `parentRunId`.

### `events`

Append-only timeline: `incidentId`, optional `runId`, `type`, optional `tool`, `status`, `timestamp`, `metadata`. Index: `by_incident_time(incidentId,timestamp)`.

### `deployments`

`incidentId`, `branch`, `commitSha`, optional `previewUrl`, optional `productionUrl`, `status`, `startedAt`, optional `readyAt`, `externalDeploymentId`. Index: `by_incident(incidentId)`.

### `verifications`

`incidentId`, `deploymentId`, `request`, `responseStatus`, `latencyMs`, `assertions`, `passed`, `freshLogsClean`, `logsCheckedAt`, `verifiedAt`. Index: `by_incident(incidentId)`. Display verified health only when `passed && freshLogsClean`.

### `performance`

`incidentId`, `deploymentId`, `baselineP95Ms`, `postFixP50Ms`, `postFixP95Ms`, `successRate`, `samples`, `verdict`, optional `note`, `measuredAt`. Index: `by_incident(incidentId)`.

### `runbooks`

`projectId`, `symptoms`, `errorSignature`, `rootCause`, `fixSummary`, `verificationSummary`, `successCount`, `avgResolutionMs`, optional `embedding`, `createdAt`, `lastUsedAt`. Index: `by_project_signature(projectId,errorSignature)`.

### `approvals`

`incidentId`, `type="DEPLOY"`, `status`, `requestedAt`, optional `decidedAt`, optional `decisionBy`, optional `notes`. Index: `by_incident(incidentId)`.

### `evalCases`

`name`, `failureMode`, `expectedCause`, `allowedFiles`, `expectedAssertions`, `status`, `createdAt`. Index: `by_name(name)`.

### `evalRuns`

`evalCaseId`, `promptVersion`, `agentVersion`, `passed`, `invariantResults`, `durationMs`, `costUsd`, `createdAt`. Index: `by_case_time(evalCaseId,createdAt)`.

### `logs`

Shared table written by the external demo app: `timestamp`, `endpoint`, `method`, `status`, `latency`, optional `error`, `requestId`, `version`, optional `projectId`. Indexes: `by_project_time(projectId,timestamp)` and `by_status_time(status,timestamp)`.

## 7. Recommended UI Flow

1. Overview loads `GET /api/overview` and `GET /api/models`.
2. Start Recovery generates `crypto.randomUUID()`, calls `POST /api/incidents`, then navigates to `/incidents/<id>`.
3. Incident detail calls `GET /api/incidents/detail?incidentId=<id>` every two seconds until `RESOLVED` or `ESCALATED`. Replace polling with Convex subscriptions after deployment.
4. Show approval buttons only when `status === "AWAITING_APPROVAL" && awaitingApproval`.
5. Do not call an incident healthy based only on status; render persisted verification and performance proof.

Example incident creation:

```ts
const response = await fetch(`${API_URL}/api/incidents`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    projectId,
    service: "checkout",
    mode: selectedMode,
    severity: "SEV2",
    idempotencyKey: crypto.randomUUID(),
  }),
});
const result = await response.json();
router.push(`/incidents/${result.data.id}`);
```

Example approval:

```ts
await fetch(`${API_URL}/api/approvals`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    incidentId,
    decision: "APPROVED",
    actor: currentUser.email,
    notes: approvalNotes,
  }),
});
```

## 8. Current Limitations

- Final Convex base URLs are unavailable until deployment/authentication completes.
- Authentication is deferred; deployed HTTP endpoints are currently public.
- HTTP routes exist, but real-time UI should eventually use Convex subscriptions.
- HTTP endpoints are not yet exposed for runbook search, eval results, global deployment listing, rollback, model-profile updates, or triggering the complete Commander workflow.
- `guardrails`, `verificationConfig`, event `metadata`, verification `request`, and `assertions` are flexible objects; handle unknown keys defensively.
