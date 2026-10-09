# Game Agent

The independent creator agent for interactive games. Official DeepSeek Harness
owns the conversation and tool loop. It does not use Agent OS's LangGraph
runtime, journals, event protocol, Ably, database or environment configuration.

## Ownership

| Layer                       | Responsibility                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Studio                      | Authoring page, independent player/chat windows, preview drafts                      |
| Game Agent                  | Harness sessions, provider calls, bounded authoring tools                            |
| Server                      | Authentication, project permission, validated appearance, versioned save/publication |
| Shared film player          | Story, media, choices, state and player actions in Studio/Web                        |
| `@repo/game-agent-protocol` | Validated authoring requests/results shared by these clients                         |

The remaining `packages/appearance-harness-ui` is an official UI composition
adapter. It contains no custom conversation renderer or agent loop.

## Local operation

Supply the required values documented in `.env.example` using a local authorized
credential. `GAME_AGENT_MODEL` is the provider's actual model identifier.
`GAME_AGENT_OPENAI_BASE_URL` includes the complete provider compatibility path
(Bailian and LiteLLM are supported). No Agent OS environment is read or inherited.

```sh
npm run dev -w game-agent
```

The development script first builds the shared contracts/compiler and app tool
entry points. Built operation uses `npm run start -w game-agent`.

Set `GAME_AGENT_WORKSPACE_ROOT` to an explicit, absolute private directory.
Symlinked directories are rejected; on macOS use the resolved path rather than
the `/tmp` or `/var` aliases. Boot verifies the directory can persist atomic writes.
The directory is not a model-accessible filesystem and its paths are not derived
from user input. Production volume requirements are described below.

Server's local settings:

```dotenv
GAME_AGENT_ENABLED=true
GAME_AGENT_WORKER_URL=http://127.0.0.1:4396
GAME_AGENT_INTERNAL_TOKEN=
GAME_AGENT_STUDIO_ORIGIN=http://localhost:9541
```

Use the same independently generated private internal token as the worker.
`GAME_AGENT_STUDIO_ORIGIN` is the exact trusted Studio origin: HTTPS in production,
or HTTP loopback for local development. It contains no path or trailing slash.
Studio uses the authenticated Server route; the old
`/api/dev/appearance-harness` route has been removed. The worker token and provider
key are not Studio/browser configuration.

Local Studio uses its existing native `/aurora/:path*` Next rewrite to carry HTTP
and WebSocket traffic to Nest. Configure `AURORA_PROXY_TARGET` for the local Server
and `AURORA_STRIP_PREFIX=1` when Nest serves at its root. No new development route
or Web rewrite is required. Production ingress must route the same prefix
directly to Nest, strip `/aurora` as in the existing Server ingress, and retain
WebSocket upgrades. The Singapore production ingress carries this route directly
to Nest.

`npm run smoke:appearance -w game-agent` exercises one SDK design request directly
and uses the configured provider. Unit/transport fixtures do not invoke it.

## Server admission

Enable `GAME_AGENT_ENABLED=true` in Server with its own
`GAME_AGENT_WORKER_URL`, `GAME_AGENT_INTERNAL_TOKEN` and required
`GAME_AGENT_STUDIO_ORIGIN`.

- `POST /aurora/game-agent/projects/:projectId/appearance/web` admits, polls or
  releases an official conversation. FD authentication, trusted origin,
  `story.generate` and `story.edit` are checked before forwarding. Server derives
  actor/project scope and project title; browser-supplied identity is not trusted.
- `/aurora/game-agent/projects/:projectId/appearance/web/:id/` mounts the official
  HTTP assets/RPC and WebSocket mux. Each HTTP request and WebSocket admission
  checks authentication and project permission, then the worker checks the
  admitted actor/project/session. No separate public worker port is exposed.
- `POST /aurora/game-agent/projects/:projectId/appearance/design` checks
  `story.generate` before one bounded SDK request.

Nest handlers receive these routes without the ingress `/aurora` prefix. They
only return validated proposals; the existing project save endpoint remains the
sole project write authority. These routes are independent of `AGENT_OS_ENABLED`
and never load Agent OS Gateway.

Worker endpoints:

- `GET /health`: listener readiness after required boot configuration and writable
  workspace initialization succeed.
  It does not prove provider availability or successful Harness child startup.
- `POST /v1/game-agent/appearance/design`: bounded SDK request.
- `POST /v1/game-agent/appearance/web`: internal, scoped official GUI control.
- `/v1/game-agent/appearance/web/:id/proxy/*`: internal official HTTP/WebSocket
  transport, requiring the service token and Server-derived scope header.

Both request hosts load `game-agent/appearance-harness-plugin`. Appearance reading,
validation, merging and submission have one implementation and the same three-tool
allowlist. Cancelled, stale, duplicate or unchanged submissions do not become new
preview results. A failed write can be retried without losing the checked proposal.

All worker routes except health require `x-game-agent-internal-token`. Container listeners bind
to `0.0.0.0`; expose them only through the trusted API/network boundary.
`Dockerfile` builds this service alone with Turbo pruning and a non-root runner.

The transport privately exchanges the official launch token for a child-only
cookie, then initializes the exact workspace and official session before serving
the first GUI page. Only the required assets and session-bound RPC/streams are
forwarded. Host filesystem, settings, model selection, shell, uploads and arbitrary
session/workspace operations remain unavailable. Request, stream, response and
concurrency bounds apply independently of the model's tools. Close/expiry tears
down HTTP and WebSocket carriers as well as the child process.

Appearance uses one validated CSS/SVG theme bundle plus localized copy. Tool inputs
reject retired skin and per-region parameter objects. Editing a theme replaces its
complete bundle; copy-only edits retain CSS, SVG assets and other locales. Region
roots allow paint/alignment only; playback geometry and interactions remain owned
by the shared player. Legacy stored data is converted at project/draft ingress,
not interpreted as another styling layer by the tools or renderer.

## Current limits

Customization is CSS/SVG appearance and localized start copy only. The player owns
the initial start screen, playback, choices, pause and completion/replay. Generated
source, menu file tools, code compilation and a separate menu runtime are removed.

## Durable sessions and deployment contract

Workspace identity hashes the authenticated actor, existing Story project, browser
window key and locale. Its private directory retains a stable public session UUID,
official session ID, last validated context and official history. Metadata/context writes are atomic and synced. Invalid/incompatible
metadata, unexpected existing files and symlinked paths fail without replacing
saved work. A normal departure or graceful worker restart stops the child process
group and releases compute ownership while keeping those files. Returning with the
same scope/window/locale reopens the saved official session. Changed appearance/context continues to invalidate stale proposals.

Production requires one Game Agent worker replica, a Recreate deployment strategy
and a private persistent ReadWriteOnce volume. The Helm component mounts the PVC
at `/var/lib/game-agent/workspaces` and sets `GAME_AGENT_WORKSPACE_ROOT` to its
private `sessions` child, created by UID/GID 1001. Pod `fsGroup: 1001` must make the
PVC root writable/traversable; verify this with the selected CSI driver.
Do not substitute an ephemeral container directory or independently
scale replicas against the same workspace tree. The current worker admits at most
two simultaneous conversation processes; this is a bounded single-worker deployment,
not a distributed session router.

`deploy/helm/fizzdragon` now includes the component, disabled by default. Enabling
it requires a concrete image revision, model/provider URL, disk StorageClass,
HTTPS Studio origin, and two distinct pre-created Secret references. The worker
receives only its model key and internal token; Nest receives only the token and
derived internal Service URL. The component adds no public ingress, cloud identity
or database credentials. It uses a read-only image filesystem, a bounded `/tmp`,
retained RWO storage and a 30-second graceful termination window. Existing ingress
still carries the authenticated HTTP/WebSocket route through Nest.
The official child loads native addons from `/tmp`, so that mount must allow
executable mappings, as the chart's default `emptyDir` does.

Singapore production runs on ACK in account `5332868355276356`, region
`ap-southeast-1`. Deployment and maintenance commands are documented in
[`deploy/aliyun-sg/README.md`](../../deploy/aliyun-sg/README.md). Migration completed
on 2026-10-08 with the Harness image, canonical datastore bindings, retained
workspace PVC and public HTTPS/readiness checks. Preparation layers that pause
background work are not the running production configuration.

A filesystem lease prevents another worker opening the same workspace. The worker
persists a launch fence before spawn and records the child's Linux process identity
immediately afterward. Automatic crash recovery is permitted only when the old
parent, recorded child and its process group are provably gone in the same
boot/PID namespace. Live/reused PIDs, an unrecorded launch, foreign namespaces and missing proof fail
closed. A new pod after a forced crash can therefore require operational recovery:
first prove the previous pod/process group has stopped and released the volume,
then remove only that workspace's obsolete `.lease`. Preserve the workspace,
candidates, metadata and history. Never unlock merely because a lease is old.

## Validation

Local tests exercise scoped admission and transport using account/permission
fixtures, a private HTTP/WebSocket fixture host, real filesystem persistence and a
separate local worker process. They cover concurrency, corruption, orphan-launch
fencing and retained candidates/history. Those checks establish local behavior;
they do not prove real-account permissions, model availability or production
ingress/volume configuration. Report any actual browser/provider walkthroughs
separately, including their fixtures and limits. Linux-only stale-process recovery
must not be reported as exercised by a macOS test run.

A local Linux/amd64 container check opened the actual official Harness child with
network access disabled, UID 1001 and a read-only root filesystem. Another actor
was denied, and the same session IDs and saved candidate survived a graceful
container restart on a disposable local volume. These checks do not establish
successful model generation, forced-crash recovery, ACK PVC behavior or acceptance
with production accounts.

The Singapore private admission check used a real FD account and Bailian's
`qwen3.8-max-0902` before cutover. It verified an owned project, two model turns,
a tool-authored appearance update, project save
and reload, and recovery of the same session/history after a graceful ACK worker
restart on the retained PVC. Recovery required one click on Reconnect. This does
not establish uninterrupted automatic reconnect or forced-crash recovery.

The completed cutover separately verified canonical database bindings and public
HTTPS/readiness and unauthenticated access checks. A fresh authenticated browser
journey through the public domain was not performed during the cutover. The
checks above do not cover every project asset or extend the supported appearance contract
capabilities.
