# On-Call Autopilot — UI Integration Specification

Repository: https://github.com/OnCall-Autonomous/on-call-autopilot

Backend sources: `convex/http.ts`, `convex/schema.ts`, `src/api/contracts.ts`.

## 1. Live Environment and Base URLs

### Production — use this for the UI handoff

```env
NEXT_PUBLIC_CONVEX_URL=https://impressive-dragon-448.convex.cloud
NEXT_PUBLIC_API_URL=https://impressive-dragon-448.convex.site
```

Vite equivalents:

```env
VITE_CONVEX_URL=https://impressive-dragon-448.convex.cloud
VITE_API_URL=https://impressive-dragon-448.convex.site
```

Production health check:

```text
https://impressive-dragon-448.convex.site/api/health
```

Production Convex dashboard:

```text
https://dashboard.convex.dev/t/ashish-soni/on-call-autopilot/impressive-dragon-448
```

### Development

```env
NEXT_PUBLIC_CONVEX_URL=https://pleasant-gecko-915.convex.cloud
NEXT_PUBLIC_API_URL=https://pleasant-gecko-915.convex.site
```

Development dashboard:

```text
https://dashboard.convex.dev/t/ashish-soni/on-call-autopilot/pleasant-gecko-915
```

All HTTP paths below are relative to the `.convex.site` API URL. Use the `.convex.cloud` URL with the Convex React client for real-time subscriptions.

### Environment status

As of this handoff, both Convex deployments have **zero configured backend environment variables**. No secret values are available to the UI team. The public URLs above are the only values that should be placed in client-visible environment variables.

Authentication is intentionally deferred. Current CORS headers allow all origins, `content-type` and `authorization`, and `GET`, `POST`, and `OPTIONS`. Treat the deployed API as demo-only until authentication and origin restrictions are added.

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
type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "rejected";
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

`mode` defaults to `PR_APPROVAL`; `severity` defaults to `SEV2`; `idempotencyKey` is generated if omitted. Reusing the same idempotency key returns the existing incident. Response `201`:

```json
{"data":{"id":"incident_id"}}
```

### `GET /api/incidents/detail?incidentId=`

Primary hero-screen endpoint. Missing ID returns `400` with `{"error":"incidentId is required"}`. A missing incident returns `{"data":null}`. A found incident returns:

```json
{
  "data": {
    "incident": {},
    "project": {},
    "runs": [],
    "steps": [],
    "events": [],
    "logs": [],
    "deployments": [],
    "verifications": [],
    "performance": [],
    "approvals": []
  }
}
```

UI mapping: `incident` → header/status; `project` → repo/service links; `runs` → agent tree; `steps` → workflow-step status and costing; `events` → timeline; `logs` → service log panel; `deployments`, `verifications`, `performance` → proof panel; `approvals` → action/history panel.

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
  incidentId: ConvexId; agent: AgentName; parentRunId?: ConvexId;
  status: "queued" | "running" | "succeeded" | "failed" | "rejected";
  idempotencyKey: string; inputSummary: string; outputSummary?: string;
  provider?: string; model?: string; promptVersion: string;
  tokens?: number; cost?: number; durationMs?: number; queuedAt: TimestampMs;
  startedAt?: TimestampMs; finishedAt?: TimestampMs; errorCode?: string;
  rejectionReason?: string;
}

export interface WorkflowStep extends ConvexSystemFields {
  incidentId: ConvexId; runId?: ConvexId;
  type: "PLAN" | "DIAGNOSE" | "PATCH" | "DEPLOY" | "VERIFY" | "PERFORMANCE" | "REPORT" | "SELECT_ASSIGNEE" | "ROLLBACK" | "ESCALATE";
  status: "scheduled" | "running" | "succeeded" | "failed" | "cancelled";
  attempt: number; idempotencyKey: string; inputSummary?: string; outputSummary?: string;
  scheduledAt: TimestampMs; startedAt?: TimestampMs; finishedAt?: TimestampMs; timeoutMs: number;
  tokens?: number; cost?: number; durationMs?: number; errorCode?: string;
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
  incident: Incident; project: Project | null; runs: AgentRun[]; steps: WorkflowStep[]; events: IncidentEvent[];
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

`incidentId`, typed `agent`, optional `parentRunId`, `status`, `idempotencyKey`, `inputSummary`, optional `outputSummary`, optional `provider`/`model`, `promptVersion`, optional `tokens`/`cost`/`durationMs`, `queuedAt`, optional `startedAt`/`finishedAt`, optional `errorCode`, and optional `rejectionReason`. Build the agent tree using `parentRunId`. Indexes support incident history, active-status lookup, parent-child lookup, and idempotency.

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

## 8. Current Backend Status and Limitations

### Implemented and deployed

- Development and production Convex deployments.
- Projects, incidents, approvals, models, overview, and incident-detail HTTP APIs.
- Durable workflow steps with `scheduled`, `running`, `succeeded`, `failed`, and `cancelled` states.
- Durable hierarchical agent runs with `queued`, `running`, `succeeded`, `failed`, and `rejected` verdicts.
- Parent/child agent-run relationships.
- Idempotent scheduling of workflow steps and agent runs.
- Append-only `WORKFLOW_STEP` and `AGENT_RUN` lifecycle events.
- Step-level token, cost, and duration storage.
- Run-level token, cost, duration, model, provider, prompt-version, error-code, and rejection-reason storage.
- Active-agent and per-incident agent-run Convex queries.
- Verification and performance tables plus deterministic resolution gates.
- Eight seeded evaluation definitions.

### Not implemented yet

- Commander scheduler that automatically creates workflow steps and agent runs after incident creation.
- Live OpenRouter model calls and prompt execution.
- Real Diagnoser evidence collection.
- GitHub read/write gateway, PR creation, and patch execution.
- Cloudflare deployment and rollback gateway.
- Independent HTTP Verifier execution.
- Performance sampling engine.
- Reporter and dynamic Temporary Specialist execution.
- Runbook retrieval, memory comparison, and executable eval runner.
- Telegram, ElevenLabs, Linkup, authentication, and product analytics.

The UI must show honest empty/configured states and must not simulate agent activity or recovery proof. `guardrails`, `verificationConfig`, event `metadata`, verification `request`, and `assertions` remain flexible objects; handle unknown keys defensively.

---

## 9. UI Product Brief

### Product promise

The interface must make this story obvious without narration:

```text
Service breaks → Commander plans → specialists investigate and repair → external deployment → independent verification → performance proof → PR and runbook
```

The UI is an operations console, not a generic AI chat application. Avoid chat bubbles, oversized gradients, decorative robots, fake terminal noise, and floating glass cards. Prefer a precise Linear/Sentry-style dark operational dashboard with restrained color and dense but readable evidence.

### Primary user

An on-call engineer operating from desktop or phone who needs to answer, in seconds:

1. What broke?
2. What is the system doing now?
3. Which agents are active?
4. What evidence supports the diagnosis?
5. What changed?
6. Was the external service actually verified?
7. Did performance regress?
8. Is human approval required?
9. Where are the deployment and PR proofs?
10. How much time and money did the recovery consume?

### Design goals

- Clean enough to understand in five seconds.
- Dense enough to prove L5 organization and observability.
- Real-time without visual jumping.
- Every status has text and an icon; never rely on color alone.
- Empty states explain what is configured versus what is currently running.
- Evidence and deterministic verdicts are visually stronger than model prose.
- Desktop-first hero screen, fully usable on a phone.

---

## 10. Visual System

Use a dark Linear/Sentry-inspired system.

### Color tokens

```css
:root {
  --bg: #090b10;
  --surface-1: #0f1219;
  --surface-2: #151923;
  --surface-3: #1b202c;
  --border: #272d3a;
  --border-strong: #353d4d;
  --text: #f4f6fa;
  --text-muted: #98a2b3;
  --text-faint: #667085;
  --accent: #8b7cff;
  --accent-soft: rgba(139, 124, 255, 0.14);
  --info: #5aa7ff;
  --success: #32d583;
  --warning: #fdb022;
  --danger: #f97066;
  --cyan: #36c5d0;
}
```

Status mapping:

```ts
const statusTone = {
  DETECTED: "danger",
  PLANNING: "info",
  DIAGNOSING: "info",
  DIAGNOSIS_REVIEW: "warning",
  PATCHING: "accent",
  PATCH_REVIEW: "warning",
  PR_READY: "accent",
  AWAITING_APPROVAL: "warning",
  DEPLOYING: "cyan",
  VERIFYING: "info",
  PERF_CHECK: "info",
  RETRYING: "warning",
  ROLLING_BACK: "danger",
  RESOLVED: "success",
  ESCALATED: "danger",
};
```

### Typography

- UI: Inter or Geist Sans.
- IDs, timestamps, commits, costs, latency, event types: Geist Mono.
- Body: 14px/20px.
- Compact labels: 12px/16px, medium weight.
- Page title: 22–28px, semibold.
- Large metric: 28–36px, semibold, tabular numbers.

### Spacing and shape

- 4px spacing grid.
- Main page gutters: 24px desktop, 16px tablet, 12px phone.
- Card padding: 16px; compact rows: 10–12px.
- Border radius: 8px cards, 6px controls, full radius only for status pills.
- Use 1px borders and minimal shadows. No excessive blur/glow.

### Motion

- 120–180ms transitions.
- Active runs may use a subtle pulse on the status dot only.
- New timeline entries fade/slide by 4px; do not animate the entire list.
- Respect `prefers-reduced-motion`.

---

## 11. Information Architecture and Routes

```text
/                         Overview
/incidents                Incident list
/incidents/[incidentId]   Hero incident detail
/runs                     Live agent runs
/approvals                Pending approvals
/deployments              Deployment history
/runbooks                 Verified memory
/evaluations              Eval cases and runs
/integrations             GitHub/Cloudflare/Telegram/etc.
/settings                 Projects, modes, guardrails, models
```

Implement these in order:

1. Overview
2. Incident detail
3. Incidents list
4. Approvals
5. Live runs
6. Evaluations
7. Deployments
8. Runbooks
9. Integrations/settings

If time is short, ship one excellent Overview and Incident Detail rather than nine weak pages.

### App shell

Desktop:

```text
┌───────────────┬─────────────────────────────────────────────┐
│ Logo          │ Top bar: project selector, health, search  │
│ Overview      ├─────────────────────────────────────────────┤
│ Incidents     │                                             │
│ Live Runs     │ Main route content                          │
│ Approvals  2  │                                             │
│ Deployments   │                                             │
│ Runbooks      │                                             │
│ Evaluations   │                                             │
│ Integrations  │                                             │
└───────────────┴─────────────────────────────────────────────┘
```

- Sidebar width: 220–240px.
- Top bar height: 56px.
- Sidebar can collapse to icons.
- Phone uses a top bar plus bottom navigation: Overview, Incidents, Approvals, More.

---

## 12. Overview Screen

### Layout

```text
Service health + active incident banner
Metric row: Active | Resolved | Success rate | MTTR | Cost
Two columns:
  Left (2/3): Active incident / recent incidents
  Right (1/3): Current agents / latest deployment / integrations
Quick actions: Trigger Demo Failure | Start Recovery
```

### Header

Show:

- Selected project and production URL.
- Overall service health: Healthy, Degraded, Incident Active, Unknown.
- Last checked timestamp.
- Primary `Start Recovery` button.
- Secondary `Trigger Demo Failure` button only in demo mode; visually mark it destructive.

### Metrics

Use `GET /api/overview`:

- Active incidents.
- Resolved count.
- Success rate formatted as percent.
- MTTR formatted as seconds/minutes.
- Total incidents.

Never display invented cost or human-time-saved values if the backend has not produced them.

### Active incident card

Show:

- Service and severity.
- Incident status and elapsed timer.
- Configured mode → effective mode.
- Root cause/confidence when available.
- Currently active agents.
- Latest timeline event.
- `Open incident` action.

When no incident exists:

```text
No active incident
The seven agent roles are configured, but zero agents are currently running.
Start a recovery after the guarded service reports a real failure.
```

This distinction is mandatory: configured roles are not active executions.

---

## 13. Incident Detail — Judging Hero Screen

This is the most important screen.

### Sticky header

Show:

- Incident short ID.
- Service.
- Severity.
- Status.
- Elapsed duration.
- Configured mode.
- Effective mode and downgrade reason.
- Confidence.
- Production URL.
- GitHub repository.
- Approval buttons only when required.

### Desktop layout

```text
┌─────────────────────┬─────────────────────────────┬───────────────────────┐
│ Agent tree (25%)    │ Timeline (45%)              │ Evidence/proof (30%)  │
│                     │                             │                       │
│ Commander           │ 12:01 PLAN scheduled       │ Root cause            │
│ ├ Diagnoser         │ 12:02 Diagnoser running    │ Evidence               │
│ ├ Fixer             │ 12:20 Patch accepted       │ Diff / PR              │
│ ├ Verifier          │ 12:45 HTTP 200              │ Verification           │
│ └ Performance       │ 12:50 p95 PASS              │ Performance            │
└─────────────────────┴─────────────────────────────┴───────────────────────┘
Footer: tokens | cost | retries | MTTR | deployment | runbook match
```

Phone layout:

- Header summary.
- Segmented tabs: `Timeline`, `Agents`, `Proof`.
- Sticky approval action bar when awaiting approval.
- Never squeeze the three desktop columns side-by-side.

### Agent tree

Build using `runs[].parentRunId`.

Each node displays:

- Role icon and name.
- Status: queued/running/succeeded/failed/rejected.
- Start and duration.
- Model or `Deterministic`.
- Tokens and cost when available.
- Child count.
- Spawn reason for Temporary Specialist when available.

Node colors:

- Queued: neutral.
- Running: blue with subtle pulse.
- Succeeded: green.
- Failed: red.
- Rejected by Commander: amber with shield/review icon.

Clicking a node filters/highlights its events in the timeline and opens a detail drawer with redacted input/output summaries, prompt version, model/provider, metrics, error code, and rejection reason.

### Timeline

Merge and sort `events` by timestamp ascending. Group visually by workflow phase, not by arbitrary date cards.

Required event renderers:

| Event | UI treatment |
|---|---|
| `STATE_TRANSITION` | Strong phase divider |
| `WORKFLOW_STEP` | Workflow chip + status |
| `AGENT_RUN` | Agent avatar/icon + verdict |
| Tool call | Tool icon + latency/result |
| Approval | Human/shield callout |
| Deployment | Cloudflare link/status |
| Verification | Assertion checklist |
| Performance | Metric comparison |
| Rollback/escalation | Red critical callout |

Timeline controls:

- Search.
- Filters: Agent, Event type, Status, Tool.
- `Only failures` toggle.
- Auto-follow toggle.
- Expand/collapse all.
- Copy safe event JSON.

Do not render secrets, authorization headers, raw tokens, or unredacted sensitive request bodies.

### Evidence and proof rail

Use tabs or stacked cards:

1. **Diagnosis** — root cause, confidence, affected surface, evidence links.
2. **Patch** — files/lines, diff, regression test, branch, commit, PR.
3. **Deployment** — status, external deployment ID, preview/production URL, timestamps.
4. **Verification** — exact request summary, status, latency, assertion checklist, fresh-log verdict.
5. **Performance** — baseline p95, post-fix p50/p95, success rate, samples, tolerance, verdict.
6. **Runbook** — match used, prior success count, newly stored memory.

The final green `Resolved` treatment must appear only when verification passed, fresh logs are clean, and performance is PASS/WAIVED.

---

## 14. Other Screen Requirements

### Incidents

Table columns:

```text
Incident | Service | Severity | Status | Effective mode | Confidence | Started | Duration | Cost | Outcome
```

Features:

- Filter by status, mode, severity, project, source, date.
- Search by incident ID, root cause, service.
- Compare two runs action.
- Empty state with Start Recovery CTA.

### Live Runs

Show only queued/running agent runs first, with completed history below. Include agent, parent, incident, status, current duration, model, prompt version, tokens, cost. A top counter must distinguish:

```text
Configured roles: 7
Running now: 0
Queued: 0
```

### Approvals

Each approval card shows incident, diagnosis summary, risk, changed files/lines, blocked-path result, PR link, requester time, expiry, and `Approve & Deploy` / `Reject` actions. Require rejection notes. Disable buttons immediately after submission and show persisted decision.

### Evaluations

Grid/table of eight named cases with last result, agent/prompt version, duration, cost, and invariant breakdown. Hard failures use red and explain the exact invariant. Add `Run suite` only when the backend endpoint exists; until then show `Runner not implemented` rather than a fake action.

### Deployments

Show incident, branch, commit, external deployment ID, status, preview/production URL, start/ready time, and rollback status.

### Runbooks

Show only verified runbooks. Include symptoms, signature, root cause, fix, verification, success count, average resolution time, and last used. Mark a match as `Hypothesis — current evidence still required`.

### Integrations

Cards for Convex, GitHub, Cloudflare, OpenRouter, Telegram, ElevenLabs, Linkup, and Analytics. Each card has `Connected`, `Missing configuration`, `Error`, or `Not implemented`. Never expose secret values; display only presence and last successful check.

---

## 15. Real-Time Data Strategy

### Initial implementation

Use HTTP for commands and first-load aggregates:

```text
GET  /api/overview
GET  /api/incidents
POST /api/incidents
GET  /api/incidents/detail
GET  /api/approvals
POST /api/approvals
GET  /api/models
```

Poll incident detail every two seconds until terminal status if the UI team cannot use generated Convex bindings immediately.

### Preferred implementation

Use `ConvexReactClient` and subscriptions for live operational data:

```tsx
import { ConvexProvider, ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: React.ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
```

Useful generated queries:

```text
dashboard:overview
dashboard:incidentDetail
agentRuns:listByIncident
agentRuns:active
workflowSteps:listByIncident
workflowSteps:listResumable
incidents:list
incidents:timeline
approvals:pending
models:list
```

Use HTTP actions for commands and Convex queries for subscriptions. After auth is added, replace `ConvexProvider` with `ConvexProviderWithAuth`.

### Cache and refresh behavior

- Do not cache active incident responses at the CDN.
- Preserve last good data during reconnect and show a `Reconnecting` banner.
- Display timestamps from server data, not client assumptions.
- Stop HTTP polling on `RESOLVED` or `ESCALATED`.
- Refetch approvals after a decision.
- Use optimistic button disabling, not optimistic incident resolution.

---

## 16. Loading, Empty, Error, and Safety States

Every screen must implement:

- Skeleton loading, not a centered spinner for the whole page.
- Empty state explaining why no data exists.
- Inline retry for network failures.
- Stale/reconnecting indicator.
- Permission/auth-required state when auth lands.
- Unknown enum fallback.

Examples:

```text
No agents running
7 roles are configured. Agent executions appear here only while an incident is active.
```

```text
No verification yet
Verification begins only after an external deployment reaches Ready.
```

```text
Performance not measured
A performance record is created only after independent verification passes.
```

Never show a green success placeholder for missing data.

---

## 17. Accessibility and Responsive Requirements

- WCAG AA contrast.
- Full keyboard navigation.
- Visible focus rings.
- Buttons at least 44px tall on phone.
- Status text plus icon, not color alone.
- Tables convert to cards or horizontal scroll on small screens.
- Timeline uses semantic ordered list.
- Agent tree has accessible expand/collapse controls.
- `aria-live="polite"` for new events; avoid announcing every performance sample.
- Respect reduced motion.

Breakpoints:

```text
Phone:   < 640px
Tablet:  640–1023px
Desktop: >= 1024px
Wide:    >= 1440px
```

---

## 18. Frontend Project Structure

Recommended Next.js App Router structure:

```text
src/
├── app/
│   ├── page.tsx
│   ├── incidents/page.tsx
│   ├── incidents/[incidentId]/page.tsx
│   ├── runs/page.tsx
│   ├── approvals/page.tsx
│   ├── deployments/page.tsx
│   ├── runbooks/page.tsx
│   ├── evaluations/page.tsx
│   ├── integrations/page.tsx
│   └── settings/page.tsx
├── components/
│   ├── app-shell/
│   ├── incidents/
│   ├── agents/
│   ├── timeline/
│   ├── proof/
│   ├── metrics/
│   └── ui/
├── hooks/
│   ├── use-incident-detail.ts
│   ├── use-agent-tree.ts
│   └── use-elapsed-time.ts
├── lib/
│   ├── api.ts
│   ├── convex.ts
│   ├── format.ts
│   ├── status.ts
│   └── env.ts
└── types/autopilot.ts
```

Recommended dependencies:

```text
next, react, react-dom
convex
@tanstack/react-query only if HTTP caching is needed
zod
lucide-react
recharts or visx for performance charts
sonner for action feedback
Tailwind CSS + shadcn/ui
```

Avoid adding a global state library until server subscriptions and URL state prove insufficient.

---

## 19. Environment Variable Contract

### Values the UI has now

```env
NEXT_PUBLIC_CONVEX_URL=https://impressive-dragon-448.convex.cloud
NEXT_PUBLIC_API_URL=https://impressive-dragon-448.convex.site
```

No backend secret values are currently configured in development or production Convex.

### Backend-only variables — never prefix with `NEXT_PUBLIC_` or expose to the browser

```env
OPENROUTER_API_KEY=
GITHUB_TOKEN=
GITHUB_OWNER=OnCall-Autonomous
GITHUB_REPO=
GITHUB_DEFAULT_BRANCH=main
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_PROJECT_NAME=
CLOUDFLARE_WORKER_NAME=
GUARDED_PRODUCTION_URL=
LINKUP_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
ELEVENLABS_WEBHOOK_SECRET=
UI_API_KEY=
```

These must be configured in Convex using `npx convex env set NAME` and `npx convex env --prod set NAME`; the UI should receive only boolean integration status, never values.

### Optional UI analytics variables

Choose one provider. Example PostHog:

```env
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Track at minimum:

```text
landing_view
demo_started
incident_created
approval_clicked
recovery_viewed
github_clicked
waitlist_signup
```

Mentors need read-only analytics access for L5 distribution scoring.

---

## 20. UI Acceptance Checklist

- [ ] Production Convex and API URLs are configured exactly as documented.
- [ ] Overview distinguishes configured roles from currently running agents.
- [ ] Incident detail shows the full agent tree and ordered event timeline.
- [ ] Failed and Commander-rejected runs are visibly different.
- [ ] Tokens, cost, duration, model, provider, and prompt version are inspectable.
- [ ] Effective-mode downgrade is visible.
- [ ] Approval controls appear only when persisted state requires them.
- [ ] Verification and performance proof are first-class panels.
- [ ] Missing proof is never rendered as success.
- [ ] Empty, loading, reconnecting, and error states are implemented.
- [ ] Phone incident view uses Timeline/Agents/Proof tabs.
- [ ] No secrets or unredacted authorization data render in the browser.
- [ ] Analytics records the meaningful conversion funnel.
- [ ] UI remains honest about backend features that are not implemented yet.
