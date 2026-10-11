# App Story Agent

The native App sends an instruction or reference document, then receives real
production progress and a saved script or playable work. Its default creation
target is an interactive film (影游): player choices lead to narrative branches,
consequences and reachable endings. Casual story/video requests use this scope;
explicit requests for ordinary linear playback or no choices produce a linear
video. Script-only requests stop at the saved script. Edits preserve the existing
work's scope unless the user changes it. Planning and image models are configured by the deployment. The video quote
card can choose an available media model before confirmation; raw tool calls
and developer configuration are not shown in the App.

## Execution

1. Server authenticates the actor, checks chapter access and persists an
   idempotent `AppStoryRun`. Only one App production can be active per project;
   existing Agent OS story runs must finish or stop before admission.
2. This worker invokes official Harness through ACP. Its only tools are
   `read_project` and `submit_decision`. Every planning turn has an isolated
   temporary workspace, a bounded timeout and one validated decision.
   Harness corrects a turn that ends without a decision at most twice. A saved,
   validated decision concludes the turn immediately; plain replies and tool
   names never count as completed work.
3. Server executes the affected production stages using the existing Story
   authoring and generation services: Script → Plot → Asset Specs → asset
   images → Storyboard → clip media → working-preview validation.
   Qwen first allocates the requested runtime across complete playable routes,
   then chooses shots within each scene's budget. Mutually exclusive branches
   are not added together when measuring playback time. App pacing requests
   include the original App message and uploaded screenplay's
   creative requirements; those take precedence over derived planner prose.
   Each video
   clip is a separate generation task of at most 15 seconds, using durations
   pinned from the configured model's catalog. Longer scenes use multiple clips;
   unsupported timings are repaired before quoting or paying for clip generation.
4. PostgreSQL stores the plan, child receipts, progress, authorization and
   execution leases. App polling survives backgrounding and reconnects; another
   Server pod resumes an expired lease after restart. Worker temporary files
   are not the source of production truth, so the worker needs no persistent
   volume.

The planner never charges, changes a project or calls a media provider. Server
confirms text proposals automatically within the submitted scope. Media batches
use the existing billing ledger. Text conversation and script work require no
compute authorization. Before each new media batch, Server pauses with the real
image/video counts and cost. The user explicitly confirms that batch's ID,
version and points; only then can the production worker reserve its quoted cost
atomically. An earlier spending ceiling never approves a later batch. The H5
refreshes expired quotes automatically without approving or generating media.
Updated quotes require a fresh confirmation. Insufficient funds pause
production with an actionable continuation. Completed media
is retained on retry. Cancellation fences new spending and waits for already
submitted work to settle. It cannot reverse a provider request already accepted.

Sending text does not authorize media spending. `POST runs/:runId/resume`
confirms the displayed estimate with `confirmedQuote: {batchId, version, points}`.
`refreshQuote: true` with that exact quote identity only refreshes the estimate;
it cannot include a spending authorization or approve generation. The replacement must be
confirmed separately. This assistant does not publish the project.

## Integration

- Worker: `apps/app-story-agent`, private HTTP port 4397.
- Contracts: `packages/app-story-protocol`.
- Admission, coordination and API: `apps/server/src/app-story-agent`.
- Native App entry: `apps/mobile/src/app/agent/[projectId]/index.tsx`.
  Its H5 container integration is a separate follow-up; this package does not
  replace the existing native page by itself.
- App H5 conversation: `apps/app-story-agent/ui`, using official Harness Layout,
  Conversation, Input, Chat, Attachment, settings and right-panel plugins. The
  host opens the current project directly without a workspace sidebar. H5 is
  owned and built by this app; Studio has no App Agent route or build dependency.
- API: `/aurora/app-story-agent/projects/:projectId/{history,runs,documents}`.
- Commands: `POST runs/:runId/cancel` and `POST runs/:runId/resume`.
- Saved canonical screenplay: `GET chapters/:chapterId/script`.
- Current selected media: `GET chapters/:chapterId/outputs`.
- Validated canonical player manifest: `GET chapters/:chapterId/preview`.
- Schema migrations: `20261010123000_app_story_agent` and
  `20261010220000_app_story_harness_ui`.

Historical Agent OS text is read for continuity. The new production flow has no
Agent OS runtime dependency. Existing Web, Studio and Game Agent flows keep
their own admission and runtime; overlapping work on the same project is fenced.

## Configuration

Worker variables are documented in `.env.example`. The token must be a separate
secret shared only with Server; provider credentials belong only to the worker.
An enabled Server requires:

```dotenv
APP_STORY_AGENT_ENABLED=true
APP_STORY_AGENT_WORKER_URL=http://127.0.0.1:4397
APP_STORY_AGENT_INTERNAL_TOKEN=
APP_STORY_AGENT_MODEL=
APP_STORY_AGENT_AUTHOR_MODEL=
APP_STORY_AGENT_IMAGE_MODEL=
APP_STORY_AGENT_VIDEO_MODEL=minimax-h3-max
APP_STORY_AGENT_AUTHORIZATION_POINTS=
```

`MODEL` must match the worker model. `AUTHOR_MODEL` is the fixed DashScope model
used by the existing structured authoring service; Server also needs its existing
regional `ALIBABA_API_KEY` and `ALIBABA_BASE_URL`. Image and video identifiers must
refer to enabled entries in the regional AI catalog. Their schema versions are
pinned when accepting a request. Planner and image models stay fixed. The
video default is MiniMax H3 Max. An unconfirmed video quote can select Seedance
2.5, HappyHorse 1.0, MiniMax H3 or H3 Max from the accessible regional catalog.
Switching requotes the pending targets, invalidates the previous quote, and
requires fresh confirmation; it never rotates models or regenerates completed
outputs. Provider schema defaults, references and clip durations are validated
by the same resolver at quote and submission. Authoring and media provider
availability must be qualified separately in `.cn` and `.com` before activation.

The Helm component `appStoryAgent` is disabled by default. Enable it only with a
revision-pinned image, regional model values, API-key Secret and internal-token
Secret. Its private service has no public ingress and receives no shared Secret
bundle. First activation needs the database migration, the configured deployment
and a matching native App release together; do not release the changed App ahead
of its Server API. Existing production release inventories remain unchanged until
that activation is explicitly assigned.

## Local validation

The App-owned H5 opens directly to the Agent conversation, with no login,
project list or App navigation. Video model selection lives only in its quote
card. It uses the App production API
through a loopback-only bridge. The fixed test account's session and authorized
project remain in the local process; the browser never receives credentials.
The local bridge serves `dist/ui`; it has no second chat UI and needs no Studio
server. `src` contains the Node worker and bridge, `ui` contains the React
client, and `scripts/build-ui.mjs` builds static browser assets. React does not
run inside the planner: the browser talks to Server through the existing typed
API. Separate TypeScript configurations keep browser and worker entry points
isolated. `npm run build:worker` and `npm run build:ui` build them independently;
`npm run build` builds both. The private worker HTTP port continues to expose
only its health and planning API, never the H5 or credentials.

```sh
npm run dev:h5 -w app-story-agent
```

The startup command builds the shared protocol and player engine, then this H5.
Open `http://localhost:8085/`. Copy `.env.h5.example` to the ignored `.env.h5`
and supply a test session, project and chapter for a local Server with the new
Agent enabled. Missing configuration keeps the page available with an explicit
configuration error and returns an unready health status; it never produces simulated
replies or silently connects to production. The bridge rejects remote Server
URLs, cross-origin requests and client attempts to switch scope or planner models.
Conversation, production progress, cancellation, continuation, saved scripts and media
use the same contracts as the native App. Actual generation still requires the
configured Harness worker, qualified models and a test account's authorization.

This app owns both the App H5 presentation and the independent Harness worker.
Server owns the typed business API, permissions, admission, authorization, media
URL resolution and playback verification. A native App can call these APIs
directly and render its own conversation. Reusing this exact browser UI requires
a WebView, but the business interface does not depend on one. No mobile changes
are required to run or validate this H5.

```sh
npm run build -w @repo/shared
npm run build -w @repo/app-story-protocol
npm run build -w app-story-agent
npm run test -w app-story-agent
npm run test -w server -- --runInBand --runTestsByPath src/app-story-agent/app-story-agent.service.spec.ts
```

The worker test uses real Harness ACP with a local Chat Completions transport.
The Server suite applies the migration to a disposable PostgreSQL engine and
checks leases, receipt recovery, authorization, cancellation and completion.
H5 transport tests cover lost replies, stale history and reconnect recovery.
These fixtures do not prove provider or physical-device
acceptance. Validate an actual regional script, linear video and interactive
film, including interruption and insufficient balance, before production release.
