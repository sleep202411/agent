# Foundry Art Studio Architecture

Status: draft
Owner: FizzDragon platform
Target surface: `apps/web/app/(studio)/art-studio`
Primary backend: `apps/server`
Provider: Microsoft Foundry through the OpenAI-compatible `/openai/v1` endpoint

## 1. Product Goal

Build a production-grade standalone image and video generation tool inside
FizzDragon Art Studio. The tool lives as its own entry in the Art Studio left
rail and is available only to active members until Java credit billing can be
integrated.

The product experience must match the operational shape users expect from
fal.ai-style generation tools:

- schema-driven model parameters, not hardcoded model UI
- durable request IDs
- visible queue position
- estimated wait time and estimated generation time
- recoverable active jobs after refresh or reconnect
- task detail with input, output, timings, logs, and raw error detail
- cancellation, retry, duplicate settings, and use-result-as-reference flows
- permanent OSS output URLs, not provider-expiring URLs

The provider is replaceable. Microsoft Foundry is the first provider; the
platform contract must also support future fal, Replicate, Alibaba, Runway, or
internal providers without rebuilding the Art Studio UI.

## 2. Non-Negotiable Product Standards

Every submitted generation task must satisfy these invariants:

- A submit action returns immediately with a stable `request_id`.
- A task never disappears after refresh, tab close, or network reconnect.
- A task has exactly one authoritative server-side state.
- A task result is served from FizzDragon-controlled OSS.
- A failed task preserves a user-readable error and a developer/operator raw
  error payload.
- Duplicate submits caused by double-clicks or network retry do not create
  duplicate jobs.
- Queue position and ETA are always best-effort but never fabricated as exact.
- Frontend schema and backend schema are versioned; mismatches fail clearly.
- Membership and concurrency limits are enforced on the server.
- The UI stays usable while tasks run; users can keep editing and queueing.

## 3. System Boundary

```text
Art Studio UI
  |
  |  /aurora/foundry/*
  v
NestJS Foundry module
  |-- membership gate
  |-- schema registry
  |-- job API
  |-- SSE events
  |-- queue position + ETA service
  |
  v
BullMQ + Redis
  |-- foundry-image queue
  |-- foundry-video queue
  |
  v
Foundry workers
  |-- OpenAI SDK / REST wrapper
  |-- provider polling
  |-- output download
  |-- OSS upload
  |
  v
Job persistence
  |-- durable job rows
  |-- job logs
  |-- output metadata
  |-- timing metrics
```

### Responsibilities

Web owns:

- `/art-studio/foundry` route
- schema-driven form rendering
- reference uploads
- queue panel
- task detail drawer
- result gallery
- optimistic task insertion after submit
- SSE subscription and polling fallback

Server owns:

- Foundry credentials
- membership authorization
- input schema validation
- idempotency
- global and per-user limits
- BullMQ enqueue/dequeue
- provider calls
- provider job polling
- output persistence to OSS
- task history and metrics
- streamable task events

Foundry owns:

- model inference only
- provider-side content safety and provider-side rate limits

Foundry does not own:

- FizzDragon membership access
- product history
- queue fairness
- result permanence
- FizzDragon task UI
- retry and cancellation semantics visible to users

## 4. SDK Choice

Use the OpenAI SDK as the generation path:

```text
https://<resource-name>.openai.azure.com/openai/v1
```

Use Foundry project deployments as the source of truth for model availability.
The execution adapter can still call the OpenAI-compatible `/openai/v1`
endpoint for models exposed there, but the product model picker must not be
hardcoded to a pair of deployment names.

Initial server implementation uses REST discovery so it can ship without adding
Azure SDK dependencies. Future production identity can switch the catalog client
to `@azure/ai-projects` + `@azure/identity` without changing the frontend
contract.

```bash
# optional future dependency, not required for the skeleton
npm install @azure/ai-projects @azure/identity
```

Environment contract:

```bash
AZURE_FOUNDRY_PROJECT_ENDPOINT=https://<resource-name>.services.ai.azure.com/api/projects/<project-name>
AZURE_FOUNDRY_API_VERSION=v1
AZURE_FOUNDRY_API_KEY=...
AZURE_FOUNDRY_BEARER_TOKEN=... # preferred for project REST / managed identity token handoff

AZURE_OPENAI_BASE_URL=https://<resource-name>.openai.azure.com/openai/v1
AZURE_OPENAI_API_KEY=...

# Optional local overrides for models whose capability cannot be inferred from
# deployment metadata. Keys can be deployment names or model names.
FOUNDRY_MODEL_CAPABILITIES_JSON='{"my-sora-deployment":"video_generation","my-image-deployment":"image_generation"}'
FOUNDRY_DEPLOYMENTS_JSON='[{"deployment":"my-image-deployment","modelName":"gpt-image-1","displayName":"GPT Image"}]'

FOUNDRY_EXECUTION_ENABLED=false
FOUNDRY_ALLOWED_LEVELS=VIP,VIP1,VIP2,VIP3
FOUNDRY_IMAGE_GLOBAL_CONCURRENCY=3
FOUNDRY_VIDEO_GLOBAL_CONCURRENCY=2
FOUNDRY_PER_USER_IMAGE_RUNNING=2
FOUNDRY_PER_USER_VIDEO_RUNNING=1
FOUNDRY_PER_USER_QUEUED_TOTAL=10
FOUNDRY_CATALOG_CACHE_MS=300000
```

## 5. Route Placement

Add a third left-rail item in Art Studio:

```text
/art-studio          Home
/art-studio/projects Projects
/art-studio/foundry  AI Generator
```

The route must remain under the `(studio)` route group so it can move with the
future standalone studio domain.

Suggested file layout:

```text
apps/web/app/(studio)/art-studio/foundry/
  page.tsx
  _components/
    foundry-workbench.tsx
    foundry-model-rail.tsx
    foundry-schema-form.tsx
    foundry-prompt-composer.tsx
    foundry-queue-panel.tsx
    foundry-task-card.tsx
    foundry-task-detail-drawer.tsx
    foundry-result-gallery.tsx
    foundry-membership-gate.tsx
  _hooks/
    use-foundry-models.ts
    use-foundry-jobs.ts
    use-foundry-job-stream.ts
    use-foundry-submit.ts
  _data/
    types.ts
    schema-ui.ts
```

## 6. Backend Module Layout

Suggested server layout:

```text
apps/server/src/foundry/
  foundry.module.ts
  foundry.controller.ts
  foundry.service.ts
  foundry-schema.registry.ts
  foundry-authz.service.ts
  foundry-queue.service.ts
  foundry-eta.service.ts
  foundry-events.service.ts
  foundry-output.service.ts
  foundry-provider.client.ts
  foundry-worker.ts
  foundry.types.ts
  foundry.errors.ts
```

The worker can initially run inside the Nest process for local development, but
production should run workers as separate processes:

```bash
npm run start:foundry-worker -w server
```

This prevents web/API latency from being coupled to long-running provider polls
and output uploads.

## 7. Model Registry

The UI must consume model definitions from the server, not from client constants.
The server discovers Foundry deployments, classifies their generation capability,
and emits a fal-style schema for every supported image/video deployment.

Endpoint:

```http
GET /aurora/foundry/models
```

Response:

```json
{
  "models": [
    {
      "id": "foundry/gpt-image-1",
      "provider": "microsoft-foundry",
      "deployment": "gpt-image-1",
      "modelName": "gpt-image-1",
      "source": "foundry-project",
      "capability": "image_generation",
      "type": "image",
      "name": "GPT Image",
      "description": "High quality image generation and editing.",
      "enabled": true,
      "schemaVersion": "2026-05-15",
      "capabilities": {
        "textToImage": true,
        "imageToImage": true,
        "video": false,
        "supportsSeed": false,
        "supportsCancel": false,
        "maxOutputs": 10
      },
      "queue": {
        "queueName": "foundry-image",
        "globalConcurrency": 3,
        "perUserRunning": 2,
        "perUserQueued": 10
      },
      "input_schema": {
        "type": "object",
        "required": ["prompt"],
        "properties": {
          "prompt": {
            "type": "string",
            "title": "Prompt",
            "maxLength": 4000,
            "ui": {
              "field": "textarea",
              "important": true,
              "rows": 6
            }
          },
          "size": {
            "type": "string",
            "title": "Size",
            "enum": ["1024x1024", "1024x1536", "1536x1024"],
            "default": "1024x1024",
            "ui": {
              "field": "segmented"
            }
          },
          "quality": {
            "type": "string",
            "title": "Quality",
            "enum": ["low", "medium", "high"],
            "default": "medium",
            "ui": {
              "field": "select"
            }
          },
          "n": {
            "type": "integer",
            "title": "Outputs",
            "minimum": 1,
            "maximum": 4,
            "default": 1,
            "ui": {
              "field": "stepper"
            }
          },
          "reference_images": {
            "type": "array",
            "title": "Reference images",
            "items": {
              "type": "string",
              "format": "uri"
            },
            "maxItems": 2,
            "ui": {
              "field": "image_upload",
              "accept": "image/jpeg,image/png,image/webp"
            }
          }
        }
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "images": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "url": { "type": "string", "format": "uri" },
                "storagePath": { "type": "string" },
                "width": { "type": "integer" },
                "height": { "type": "integer" }
              }
            }
          }
        }
      }
    }
  ]
}
```

### Schema Rules

- `input_schema` follows JSON Schema with fal-style `ui` hints.
- Required fields and `ui.important=true` render in the main form.
- Optional fields with defaults render in Advanced Settings.
- Backend validates the same schema before enqueue.
- Every schema has a `schemaVersion`.
- Submit requests must include `schemaVersion`; stale clients receive
  `SCHEMA_VERSION_MISMATCH`.
- The schema describes UI controls but not credentials or provider internals.

## 8. State Machine

External status is fal-like:

```text
IN_QUEUE
IN_PROGRESS
COMPLETED
FAILED
CANCELLED
EXPIRED
```

Internal stage is product-specific:

```text
created
queued
validating
calling_provider
provider_queued
generating
fetching_output
uploading_to_oss
completed
failed
cancelled
expired
```

Allowed transitions:

```text
created -> queued
queued -> validating
queued -> cancelled
validating -> calling_provider
validating -> failed
calling_provider -> provider_queued
calling_provider -> generating
calling_provider -> failed
provider_queued -> generating
provider_queued -> failed
provider_queued -> cancelled
generating -> fetching_output
generating -> failed
generating -> cancelled_requested
fetching_output -> uploading_to_oss
fetching_output -> failed
uploading_to_oss -> completed
uploading_to_oss -> failed
any non-terminal -> expired
failed -> queued        (retry creates a new attempt)
completed -> queued     (duplicate settings creates a new job)
```

Terminal stages:

```text
completed
failed
cancelled
expired
```

UI stages should use friendly copy:

```text
queued           Waiting for a generation slot
validating       Checking request
calling_provider Sending to Foundry
provider_queued  Waiting in provider queue
generating       Generating
fetching_output  Fetching result
uploading_to_oss Saving result
completed        Completed
failed           Failed
cancelled        Cancelled
expired          Expired
```

## 9. Job Data Model

Use a durable task table for product history. Redis and BullMQ are not enough
because they are execution infrastructure, not the product record.

If server-owned DB is not ready, implement the same interface over Redis hashes
first, then migrate to DB behind the repository boundary.

Recommended logical model:

```ts
type FoundryJob = {
  id: string;
  userId: string;
  userLevel: string | null;
  type: "image" | "video";
  provider: "microsoft-foundry";
  modelId: string;
  deployment: string;
  schemaVersion: string;

  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "EXPIRED";
  stage:
    | "created"
    | "queued"
    | "validating"
    | "calling_provider"
    | "provider_queued"
    | "generating"
    | "fetching_output"
    | "uploading_to_oss"
    | "completed"
    | "failed"
    | "cancelled"
    | "expired";

  input: Record<string, unknown>;
  normalizedInput: Record<string, unknown>;
  prompt: string;
  idempotencyKey: string;

  providerJobId?: string;
  providerRequest?: Record<string, unknown>;
  providerResponse?: Record<string, unknown>;

  outputs: FoundryOutput[];
  error?: FoundryJobError;

  queueName: "foundry-image" | "foundry-video";
  queuePosition?: number | null;
  progress?: number | null;

  estimatedWaitSeconds?: number | null;
  estimatedRunSeconds?: number | null;
  estimatedTotalSeconds?: number | null;
  etaConfidence?: "low" | "medium" | "high";

  attempt: number;
  retryOfJobId?: string;

  createdAt: string;
  queuedAt?: string;
  startedAt?: string;
  providerSubmittedAt?: string;
  providerStartedAt?: string;
  providerCompletedAt?: string;
  outputFetchedAt?: string;
  ossUploadedAt?: string;
  completedAt?: string;
  updatedAt: string;

  metrics: {
    queueWaitMs?: number;
    providerRunMs?: number;
    outputFetchMs?: number;
    ossUploadMs?: number;
    totalMs?: number;
  };
};

type FoundryOutput = {
  id: string;
  type: "image" | "video";
  url: string;
  storagePath: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  mimeType?: string;
  bytes?: number;
  providerTemporaryUrl?: string;
  providerExpiresAt?: string;
  createdAt: string;
};

type FoundryJobError = {
  code:
    | "VALIDATION_ERROR"
    | "SCHEMA_VERSION_MISMATCH"
    | "MEMBERSHIP_REQUIRED"
    | "MEMBERSHIP_EXPIRED"
    | "RATE_LIMITED"
    | "QUEUE_LIMIT_EXCEEDED"
    | "PROVIDER_429"
    | "PROVIDER_5XX"
    | "PROVIDER_TIMEOUT"
    | "PROVIDER_CONTENT_FILTER"
    | "OUTPUT_EXPIRED"
    | "OSS_UPLOAD_FAILED"
    | "WORKER_CRASHED"
    | "CANCELLED_BY_USER"
    | "UNKNOWN";
  message: string;
  userMessage: string;
  raw?: unknown;
  retryable: boolean;
  createdAt: string;
};
```

## 10. API Contract

### List Models

```http
GET /aurora/foundry/models
```

Returns enabled models and schemas. Anonymous users should be blocked by the
global auth gate; non-members can still receive schemas if the UI needs to show
locked previews, but submit remains forbidden.

### Submit Job

```http
POST /aurora/foundry/jobs
```

Request:

```json
{
  "modelId": "foundry/sora-2",
  "schemaVersion": "2026-05-15",
  "input": {
    "prompt": "A cinematic dragon flying through a neon city",
    "size": "1280x720",
    "seconds": 8,
    "n": 1
  },
  "idempotencyKey": "client-generated-uuid"
}
```

Response:

```json
{
  "request_id": "fd_foundry_01JZ...",
  "status": "IN_QUEUE",
  "stage": "queued",
  "queue_position": 3,
  "estimated_wait_seconds": 180,
  "estimated_run_seconds": 260,
  "estimated_total_seconds": 440,
  "eta_confidence": "medium",
  "status_url": "/aurora/foundry/jobs/fd_foundry_01JZ.../status",
  "response_url": "/aurora/foundry/jobs/fd_foundry_01JZ...",
  "cancel_url": "/aurora/foundry/jobs/fd_foundry_01JZ.../cancel"
}
```

### List Jobs

```http
GET /aurora/foundry/jobs?scope=active,recent&type=video&limit=50&cursor=...
```

Response:

```json
{
  "items": [],
  "nextCursor": null
}
```

`scope=active,recent` returns:

- all active jobs
- recent terminal jobs, newest first

### Job Status

```http
GET /aurora/foundry/jobs/:id/status
```

Response:

```json
{
  "request_id": "fd_foundry_01JZ...",
  "status": "IN_PROGRESS",
  "stage": "generating",
  "progress": 42,
  "queue_position": null,
  "estimated_wait_seconds": 0,
  "estimated_run_seconds": 180,
  "estimated_total_seconds": 180,
  "eta_confidence": "medium",
  "logs": [
    {
      "time": "2026-05-15T12:00:00.000Z",
      "stage": "calling_provider",
      "message": "Submitted to Foundry"
    }
  ],
  "response_url": "/aurora/foundry/jobs/fd_foundry_01JZ..."
}
```

### Job Detail

```http
GET /aurora/foundry/jobs/:id
```

Response includes the full task: input, outputs, logs, timings, metrics, and
error detail. Users can access only their own jobs. Admin endpoints can be
added later.

### Cancel Job

```http
POST /aurora/foundry/jobs/:id/cancel
```

Rules:

- `queued`: remove or mark BullMQ job cancelled.
- `calling_provider`: mark cancel requested; provider submission may still win
  the race.
- `provider_queued` or `generating`: call provider cancel if supported; if not,
  mark as cancel requested and suppress output persistence.
- `fetching_output` or `uploading_to_oss`: cancellation becomes best-effort;
  UI copy should say cancellation may not stop a nearly finished job.

### Retry Job

```http
POST /aurora/foundry/jobs/:id/retry
```

Creates a new job with:

- same model
- same normalized input
- new `id`
- `retryOfJobId` pointing to the original
- fresh idempotency key

### Stream Events

```http
GET /aurora/foundry/jobs/stream
```

SSE events:

```text
event: job.created
event: job.updated
event: job.completed
event: job.failed
event: job.cancelled
event: queue.updated
```

Payload:

```json
{
  "job": {
    "id": "fd_foundry_01JZ...",
    "status": "IN_PROGRESS",
    "stage": "generating",
    "queuePosition": null,
    "estimatedRunSeconds": 180,
    "updatedAt": "2026-05-15T12:00:00.000Z"
  }
}
```

Frontend must reconnect automatically and then refetch active jobs because SSE
delivery is not a durable event log.

## 11. Queue Design

Queues:

```text
foundry-image
foundry-video
```

Default concurrency:

```text
foundry-image global running: 3
foundry-video global running: 2
per-user image running: 2
per-user video running: 1
per-user queued total: 10
```

Video is capped at 2 because Sora 2 currently allows only two concurrent video
creation jobs per resource. Keep the cap configurable but never default above
provider limits.

### Admission Control

Before enqueue:

1. Verify authenticated user.
2. Verify active member level.
3. Verify schema version.
4. Validate input against schema.
5. Check idempotency key.
6. Check per-user active/queued limits.
7. Check global emergency queue depth.
8. Create durable job row.
9. Add BullMQ job.
10. Emit `job.created`.

### Idempotency

Idempotency key scope:

```text
userId + modelId + idempotencyKey
```

If the same key is submitted again within 24 hours:

- return the existing job
- do not create a second BullMQ job
- do not call Foundry twice

This covers double-click, browser retry, and transient network failure.

### Fairness

Initial fairness is enforced by per-user running and queued limits. If usage
grows, add a weighted scheduler:

- one active video per user before any user gets a second running video
- VIP tier can affect queue priority only after product explicitly decides so
- never starve lower tiers

## 12. Queue Position

Queue position is computed against waiting jobs in the queue:

```text
position = index of current job among waiting jobs
```

Display copy:

```text
Queued #1
Queued #2
Queued #3
```

If a task is delayed or paused, include it in queue position only if it blocks
future work. If a task is already running, `queuePosition = null`.

Queue position must be recomputed on:

- new enqueue
- worker starts a job
- job completes
- job fails
- job cancels
- retry is submitted

Emit `queue.updated` to refresh all visible positions.

## 13. ETA Design

ETA is a product estimate, not a guarantee. API fields must use "estimated",
and UI copy should use "about".

### Inputs

Estimate based on:

- queue position
- queue concurrency
- running jobs elapsed time
- model id
- type
- size
- seconds
- output count `n`
- historical p50 and p90 run times
- historical p50 and p90 queue wait times

### Initial Heuristics

Until enough history exists:

```text
gpt-image-1 1024x1024 n=1        run: 30-90s
gpt-image-1 portrait/landscape   run: 45-120s
sora-2 4s 720p                  run: 2-5m
sora-2 8s 720p                  run: 4-8m
sora-2 8s 1080p                 run: 6-12m
oss upload image                run: <10s
oss upload video                run: 10-60s
```

The first implementation can return:

```ts
estimatedRunSeconds = heuristic(modelId, input);
estimatedWaitSeconds = sumEstimatedRemainingWorkBefore(job) / queueConcurrency;
estimatedTotalSeconds = estimatedWaitSeconds + estimatedRunSeconds;
etaConfidence = historySampleCount >= 30 ? "high" : historySampleCount >= 10 ? "medium" : "low";
```

### Running Job Remaining Time

For running jobs ahead of a waiting job:

```text
remaining = max(p50RunSeconds - elapsedSeconds, minRemainingSeconds)
```

For waiting jobs ahead:

```text
remaining = estimatedRunSeconds(job)
```

For current running job:

```text
estimatedRunSeconds = max(p50RunSeconds - elapsedSeconds, 0)
```

### History Metrics

Persist metrics per bucket:

```text
provider:modelId:type:size:seconds:n
```

Store:

- sample count
- p50 total run time
- p90 total run time
- p50 queue wait
- p90 queue wait
- success rate
- content-filter rate
- provider rate-limit rate

Use p50 for normal ETA and p90 in tooltips:

```text
Usually 4 min. Can take up to 9 min during high traffic.
```

## 14. Worker Flow

### Image Job

```text
start
  -> stage validating
  -> stage calling_provider
  -> call client.images.generate
  -> decode b64_json outputs
  -> stage uploading_to_oss
  -> upload images to OSS
  -> save outputs
  -> stage completed
```

Image output must not rely on provider temporary output. Store all bytes in OSS.

### Video Job

```text
start
  -> stage validating
  -> stage calling_provider
  -> client.videos.create
  -> save providerJobId
  -> stage provider_queued
  -> poll provider job
  -> stage generating when provider status moves
  -> stage fetching_output after provider completed
  -> download video content
  -> stage uploading_to_oss
  -> upload MP4 to OSS
  -> save outputs
  -> stage completed
```

Video provider outputs can expire. The worker must download and upload to OSS
as soon as provider completion is observed.

### Polling

Use exponential backoff with a max interval:

```text
first 60s: every 5s
after 60s: every 10s
after 5m: every 20s
max: 30s
```

Worker must persist `providerJobId` before polling so another worker can resume
after process restart.

## 15. Retry Policy

Queue-level retry:

```ts
attempts: 3
backoff: { type: "exponential", delay: 2000 }
```

Do not blindly retry content filtering or validation errors.

Retryable:

- provider 429
- provider 5xx
- provider timeout
- transient network failure
- OSS upload failure
- worker crash

Not retryable:

- schema validation error
- membership required
- membership expired
- provider content filter
- unsupported media type
- output expired when no provider job can regenerate result

When a retry succeeds, keep attempt logs. When all attempts fail, mark the job
`FAILED` with a stable error code.

## 16. Membership Gate

Membership is enforced in `apps/server`, not only in the UI.

Rules:

- allowed user levels come from `FOUNDRY_ALLOWED_LEVELS`
- if Java returns `expireTime`, server must treat expired memberships as
  ineligible
- queued jobs should re-check membership immediately before provider call
- if membership expires while queued, fail with `MEMBERSHIP_EXPIRED`
- completed outputs remain viewable after membership expires, unless product
  later decides otherwise

Frontend lock state:

- non-member sees the full product surface in read-only preview mode
- Generate button opens membership dialog
- queue/history is hidden or replaced by upgrade CTA if no active membership

## 17. Result Storage

OSS path convention:

```text
foundry/{userId}/{yyyy}/{mm}/{jobId}/output-{index}.{ext}
foundry/{userId}/{yyyy}/{mm}/{jobId}/thumb-{index}.jpg
```

Store:

- full output URL
- storage path
- MIME type
- byte size
- dimensions
- duration for video
- provider temporary URL if available
- provider expiry timestamp if available

Never expose provider API keys or signed provider URLs through the frontend.

## 18. UI Architecture

### Workbench Layout

Desktop:

```text
┌────────────────────────────────────────────────────────────────┐
│ Studio Nav                                                      │
├───────┬──────────────────────┬─────────────────────────────────┤
│ Rail  │ Main Workbench       │ Queue / History                 │
│       │                      │                                 │
│       │ Model tabs           │ Active jobs                     │
│       │ Prompt composer      │ Queued / running cards          │
│       │ Schema controls      │ Recent completed / failed       │
│       │ Reference uploads    │                                 │
│       │ Result gallery       │                                 │
└───────┴──────────────────────┴─────────────────────────────────┘
```

Mobile:

- main composer first
- queue panel collapses into bottom sheet
- result gallery remains visible after submit
- advanced settings use accordion

### Main Workbench

Required areas:

- media type switch: Image / Video
- model picker with provider/model description
- prompt composer with reference attachments
- main schema fields
- advanced schema fields
- estimate strip before submit
- generate button
- result gallery

Estimate strip:

```text
Video · Sora 2 · 1280x720 · 8s
Estimated generation: about 4-8 min
Current video queue: 2 running · 3 waiting
```

### Queue Panel

Visible job card states:

```text
Queued #3 · about 4 min
Waiting for video slot
Sending to Foundry
Generating · about 3 min left
Saving result
Completed · 6m 12s
Failed · Content policy
Cancelled
```

Each card actions:

- cancel, for non-terminal jobs
- retry, for retryable failed jobs
- duplicate settings
- open details
- use as reference, for completed output
- download, for completed output
- copy link, for completed output

### Task Detail Drawer

Tabs:

```text
Overview
Input
Result
Timeline
Logs
Error
Raw
```

Overview:

- status
- queue position
- ETA
- elapsed time
- model
- provider
- created time
- completed time
- output count

Input:

- prompt
- all schema parameters
- reference files
- schema version

Result:

- image/video preview
- OSS URL
- storage path
- dimensions
- duration
- download
- use as reference

Timeline:

```text
12:00:01 Submitted
12:00:01 Queued #3
12:02:14 Started
12:02:15 Sent to Foundry
12:06:45 Provider completed
12:06:50 Saved to OSS
12:06:51 Completed
```

Logs:

- operator-friendly messages
- provider job id hidden behind developer disclosure if needed

Error:

- user message
- retryability
- suggested action
- raw error disclosure for debugging

Raw:

- sanitized JSON payload
- no credentials

### Result Gallery

Completed results appear both in the task card and gallery.

Gallery actions:

- preview full screen
- download
- copy link
- copy prompt
- duplicate settings
- use as reference
- delete from local gallery view

Deleting from gallery should not delete the durable job or OSS file unless
explicit product spec adds destructive deletion later.

## 19. UX Copy Rules

All user-facing copy must go through `apps/web/messages/{locale}.json`.

English-first keys should cover:

```text
foundry.title
foundry.subtitle
foundry.generate
foundry.memberOnly
foundry.queue.position
foundry.queue.estimatedWait
foundry.status.queued
foundry.status.generating
foundry.status.uploading
foundry.actions.cancel
foundry.actions.retry
foundry.actions.duplicate
foundry.actions.useAsReference
foundry.detail.timeline
foundry.detail.rawError
```

Do not hardcode Chinese or English strings in TSX.

## 20. Realtime and Recovery

Primary:

```text
SSE /aurora/foundry/jobs/stream
```

Fallback:

```text
GET /aurora/foundry/jobs?scope=active,recent every 2-5 seconds
```

Recovery rules:

- on page mount, fetch active + recent jobs
- open SSE
- on SSE reconnect, refetch active jobs
- on tab visibility change to visible, refetch active jobs
- if a task is active but no update for 60 seconds, poll its status directly
- never rely only on in-memory Redux/Zustand for task state

## 21. Extreme Cases

Must be handled before production release:

- double-click Generate
- browser retries submit after timeout
- user refreshes immediately after submit
- user closes tab while job runs
- user opens another device
- SSE disconnects
- SSE reconnects after several minutes
- Redis is briefly unavailable
- BullMQ worker restarts
- server restarts with active provider jobs
- Foundry returns 429
- Foundry returns 5xx
- Foundry content filter rejects prompt
- Foundry accepts job but status polling fails
- Foundry job completes but output download fails
- Foundry output expires before download
- OSS upload fails
- OSS upload succeeds but DB update fails
- membership expires while job is queued
- user exceeds per-user queued limit
- many users submit Sora jobs at once
- stale frontend schema version submits
- model is disabled while user has form open
- cancel races with worker start
- retry races with original job finishing
- completed event is missed by browser
- toast disappears but failure remains discoverable

## 22. Observability

Server logs should include:

- job id
- user id
- provider
- model id
- stage transitions
- provider job id
- provider status
- durations
- error code

Metrics:

```text
foundry.queue.depth{queue}
foundry.queue.wait_ms{queue,model}
foundry.job.run_ms{model,size,seconds}
foundry.job.total_ms{model}
foundry.job.success_count{model}
foundry.job.failure_count{model,error_code}
foundry.provider.rate_limit_count{model}
foundry.provider.content_filter_count{model}
foundry.oss.upload_ms{type}
foundry.membership.denied_count{level}
```

Admin/debug endpoint:

```http
GET /aurora/foundry/admin/stats
```

Only expose after admin auth exists, or keep it disabled in production.

## 23. Security

- API keys stay server-side only.
- Frontend never calls Foundry directly.
- Job detail access is scoped to job owner.
- Raw provider responses are sanitized before returning to browser.
- Reference uploads validate file type and size.
- Prompt and inputs are stored for task history; if privacy requirements change,
  add retention and delete policies.
- SSE stream sends only jobs owned by the current user.
- Idempotency keys cannot be used across users.

## 24. Testing Plan

### Unit Tests

- schema validation
- stage transition guards
- ETA calculation
- queue position calculation
- membership checks
- idempotency
- retryability mapping
- provider error classification

### Integration Tests

- submit image job
- submit video job
- duplicate submit returns existing job
- non-member submit rejected
- per-user limit rejected
- worker completes image and writes OSS output
- worker resumes provider video job after restart
- cancel queued job
- retry failed job

### Frontend Tests

- non-member lock state
- schema renders main and advanced controls
- submit inserts optimistic task card
- queue card updates from SSE
- polling fallback updates task
- detail drawer shows input/result/timeline/error
- completed result enters gallery
- failed task remains discoverable after toast disappears

### Manual QA

- desktop, tablet, mobile
- slow network
- browser refresh mid-job
- multiple tabs
- expired membership
- provider content filter
- provider timeout
- OSS upload failure simulation

## 25. Implementation Phases

### Phase 0: Architecture Contract

- Add this document.
- Confirm Foundry project endpoint and catalog authentication mode.
- Confirm storage choice for durable jobs.

Done when:

- product, frontend, and backend boundaries are agreed
- no implementation starts from ambiguous queue semantics

### Phase 1: Server Schema + Job Skeleton

- Add `FoundryModule`.
- Add deployment catalog, capability classifier, and schema registry.
- Add membership gate.
- Add job repository interface.
- Add submit/list/status/detail/cancel/retry endpoints returning mock jobs.
- Add idempotency.

Done when:

- frontend can render models from server
- submit returns fal-like `request_id/status_url/response_url`
- non-members are rejected server-side

### Phase 2: Queue + Worker

- Add BullMQ image/video queues.
- Add worker process.
- Add state transitions.
- Add queue position.
- Add ETA service.
- Add SSE event stream.
- Add OpenAI SDK provider client.
- Add image generation path.
- Add video generation path with provider polling.
- Add OSS upload.

Done when:

- real Foundry image/video jobs complete into OSS
- queue position updates live
- refresh recovers active jobs

### Phase 3: Product UI

- Add `/art-studio/foundry`.
- Add sidebar entry.
- Add model picker and schema renderer.
- Add prompt composer.
- Add queue panel.
- Add task detail drawer.
- Add result gallery.
- Add membership lock UX.

Done when:

- user can submit, watch queue, inspect details, retry/cancel, and reuse outputs
- UI stays usable while jobs run

### Phase 4: History + Metrics

- Add durable history pagination.
- Add metrics buckets for ETA.
- Add completed/failed filters.
- Add copy settings and retry lineage.
- Add operator logs.

Done when:

- user can audit prior jobs
- ETA improves from historical metrics

### Phase 5: Hardening

- Run extreme-case checklist.
- Add load testing for queue surge.
- Add worker restart tests.
- Add provider error simulations.
- Add production runbook.

Done when:

- no known path loses task state
- no known path exposes provider credentials
- no known path relies on provider temporary URLs after completion

## 26. Acceptance Criteria

The feature is product-ready when all are true:

- active members can generate images and videos from `/art-studio/foundry`
- non-members cannot submit generation requests
- all model parameters are schema-driven
- queue position is visible for waiting jobs
- estimated wait and run time are visible
- every task has a stable detail view
- every task has timeline, logs, metrics, input, output, and error sections
- refresh and reconnect recover active jobs
- completed outputs are stored on OSS
- failed jobs are retryable when safe
- cancellation works for queued jobs and is best-effort for provider jobs
- duplicate submit does not duplicate generation
- worker restart does not orphan provider jobs
- provider errors and content filters are classified
- UI is responsive on desktop and mobile

## 27. Open Decisions

- Durable job storage: server-owned DB table vs Redis-first repository.
- Whether membership expiry should block queued jobs at provider-call time.
- Whether generated outputs remain accessible after membership expires.
- Whether VIP tier should affect queue priority.
- Whether to expose admin stats in the first release.
- Whether deleted gallery items should only hide locally or also delete OSS.
