# UI HTTP API

Convex serves these routes from the deployment's `.convex.site` URL. Responses are JSON. Authentication is intentionally deferred; add it before exposing non-demo data.

## Routes

- `GET /api/health` — liveness response.
- `GET /api/projects` — configured guarded services.
- `POST /api/projects` — create/update a project by repository name.
- `GET /api/incidents?projectId=&limit=` — newest incidents, maximum 100.
- `POST /api/incidents` — create an idempotent dashboard incident. Replaying the same key and logical payload returns the original ID; reusing the key with a different payload returns `{"error":"IDEMPOTENCY_KEY_PAYLOAD_CONFLICT"}` without creating records.
- `GET /api/incidents/detail?incidentId=` — complete hero-screen aggregate: incident, project, agent tree, timeline, deployments, verification, performance, approvals.
- `GET /api/overview?projectId=` — project list, MTTR/success/active metrics, active incidents.
- `GET /api/approvals` — pending deployment approvals.
- `POST /api/approvals` — approve or reject a pending deployment.
- `GET /api/models` — active model/deterministic agent profiles.

## Create project

```json
{
  "name": "Checkout Demo",
  "owner": "OnCall-Autonomous",
  "repo": "OnCall-Autonomous/checkout-demo",
  "defaultBranch": "main",
  "productionUrl": "https://checkout-demo.example.workers.dev",
  "cloudflareProject": "checkout-demo",
  "defaultMode": "PR_APPROVAL",
  "baselineLatencyMs": 500,
  "guardrails": {
    "allowedRepos": ["OnCall-Autonomous/checkout-demo"],
    "allowedPaths": ["src"],
    "blockedPaths": ["migrations", ".github", "src/auth", "src/billing"],
    "maxChangedFiles": 3,
    "maxChangedLines": 80,
    "confidenceThreshold": 0.8
  },
  "verificationConfig": {
    "method": "POST",
    "path": "/checkout",
    "expectedStatus": 200
  }
}
```

## Create incident

```json
{
  "projectId": "<Convex project document ID>",
  "service": "checkout",
  "mode": "AUTO_RESOLVE",
  "severity": "SEV2",
  "idempotencyKey": "dashboard-click-unique-id"
}
```

An exact replay compares `projectId`, source (`dashboard` for this route), `service`, `severity`, and configured mode. The same key with exact values returns the original incident ID in the existing `201` response envelope and creates no additional incident or initial event. If any compared value differs, the request fails with `400` and `{"error":"IDEMPOTENCY_KEY_PAYLOAD_CONFLICT"}`. Use a new key for a logically different request.

## Decide approval

```json
{
  "incidentId": "<Convex incident document ID>",
  "decision": "APPROVED",
  "actor": "engineer@example.com",
  "notes": "Reviewed the minimal patch"
}
```

## Initial deployment

```bash
npx convex dev                 # authenticate and create/link a deployment
npm run seed                   # seed model profiles and eight eval cases
npm run deploy                 # deploy production functions
```

After `convex dev`, Convex replaces the checked-in temporary `_generated` type shims with deployment-specific generated files. Give the UI `VITE_API_URL` or `NEXT_PUBLIC_API_URL` equal to the generated `https://<deployment>.convex.site` URL.

## Investigate-only model configuration

Creating an `INVESTIGATE_ONLY` incident schedules a durable workflow with the exact path `DETECTED -> PLANNING -> DIAGNOSING -> DIAGNOSIS_REVIEW -> ESCALATED`. It persists a deterministic Commander plan, performs one Diagnoser request, validates the structured diagnosis, and ends with a human handoff. It never patches, deploys, verifies, approves, or writes to GitHub/Cloudflare.

Seed or upsert an enabled `DIAGNOSER` LLM model profile, then configure these server-side Convex environment variables (never browser variables):

- `DIAGNOSER_BASE_URL` — OpenAI-compatible API base URL (the workflow appends `/chat/completions`).
- `DIAGNOSER_API_KEY` — bearer credential.

The model name, temperature, and maximum token count come from the enabled profile. Missing configuration, non-2xx HTTP responses, malformed envelopes, and invalid diagnosis JSON fail closed to `ESCALATED`; the failure is persisted in the run/events and the handoff explicitly says no diagnosis was fabricated and no repair/deployment was attempted.
