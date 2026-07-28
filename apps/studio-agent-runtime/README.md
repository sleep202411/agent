# Studio Agent Runtime

Provider-independent, durable execution runtime for StoryOS and future
FizzDragon assistant surfaces. This application is intentionally independent
from the legacy Mastra agent.

## Runtime topology

One immutable image is deployed as two independently scalable worker roles:

| Role       | Entrypoint                       | Task queue                   | Health / metrics default | Responsibility                                                |
| ---------- | -------------------------------- | ---------------------------- | ------------------------ | ------------------------------------------------------------- |
| Control    | `node dist/worker-control.js`    | `studio-agent-control-v1`    | `3010` / `0.0.0.0:9464`  | Executes only the precompiled deterministic Temporal workflow |
| Activities | `node dist/worker-activities.js` | `studio-agent-activities-v1` | `3011` / `0.0.0.0:9465`  | Calls Qwen, the Nest control plane, and approved capabilities |

`npm run build -w studio-agent-runtime` creates
`dist/studio-agent-workflow-bundle.js`. A compiled entrypoint loads that
artifact and never invokes the workflow bundler at startup; a missing bundle
fails with the build command instead of an opaque resolution error. Running the
TypeScript entrypoint (`tsx src/worker-control.ts`, which is what the local
launcher does) bundles from source at startup and says so at `WARN`. The mode is
derived from the extension of the running module, so the image — which contains
`dist` only — cannot select it by configuration.

The per-role endpoint defaults differ because both roles are separate pods in
production but two processes on one host locally. Helm sets both values
explicitly per pod, so the defaults never apply there.

Nest/Postgres is the canonical control plane. It owns authentication, threads,
messages, run state, manifests, permission evaluation, actions, approvals,
inputs, event ordering, and capability execution. This runtime owns
deterministic orchestration and provider streaming.

Workers submit `StudioAgentEventDraft`; only Nest allocates `eventId` and the
gap-free per-thread `sequence`. Internal commands use
`x-studio-agent-runtime-token` and the contracts exported by
`@repo/shared/studio-agent`.

## Configuration contract

Configuration is validated before a process opens a Temporal connection. A
missing credential, unknown TLS mode, invalid URL, contract-drifting task
queue, or unsafe shutdown window terminates the process. There are no
credential or plaintext fallbacks.

Both worker roles load `apps/studio-agent-runtime/.env` themselves before
validating anything, so every documented command works without an `--env-file`
flag. A variable already present in the process environment always wins, and the
startup log names the file, the keys it contributed, and the keys it did not
override. The production image ships no `.env`, so there the load is a reported
no-op.

Required by both worker roles:

- `STUDIO_AGENT_RELEASE`: immutable image/source revision shown in diagnostics
  and assigned as the Temporal Worker Deployment build ID.
- `TEMPORAL_ADDRESS`
- `TEMPORAL_NAMESPACE`
- `TEMPORAL_TLS_MODE`: exactly `mtls` or `disabled`.
- `TEMPORAL_TLS_CA`, `TEMPORAL_TLS_CERT`, and `TEMPORAL_TLS_KEY` when
  `TEMPORAL_TLS_MODE=mtls`.

Required by the activities role:

- `STUDIO_AGENT_INTERNAL_BASE_URL`
- `STUDIO_AGENT_RUNTIME_TOKEN` (minimum 32 characters)
- `ALIBABA_API_KEY`

Production Helm releases only accept `TEMPORAL_TLS_MODE=mtls`. The explicit
`disabled` mode exists solely for a deliberate local plaintext Temporal
server, and it rejects any simultaneous TLS material. Qwen is accessed through
the Alibaba AI SDK; `ALIBABA_BASE_URL` selects the regional DashScope endpoint.
`STUDIO_AGENT_MODEL` is the text model and `STUDIO_AGENT_VISION_MODEL` is the
multimodal model selected by the control plane whenever canonical context
contains a ready image attachment. The activity worker accepts only those two
configured model IDs; a plan cannot select an arbitrary provider model.

Operational concurrency, timeout, streaming, health, metrics, and shutdown
knobs are listed in [`.env.example`](./.env.example) and validated in
[`src/config.ts`](./src/config.ts).

## Health, readiness, and metrics

Each worker exposes a private process endpoint on
`STUDIO_AGENT_HEALTH_HOST:STUDIO_AGENT_HEALTH_PORT`:

- `GET /healthz` is live unless the Temporal worker has entered a fatal state.
- `GET /ready` succeeds only while the role-specific Temporal poller is
  actively polling **and** the loaded code still matches the build on disk. It
  fails during startup, drain, failure, and staleness (`status: "stale"`).
- `HEAD` is supported for both endpoints. Other methods are rejected.

Responses are non-cacheable JSON containing only service, role, immutable
release, lifecycle status, worker state, poller state, and — when stale — the
reason. No secret or provider payload is exposed.

### Stale code cannot pass silently

Measuring a fix against a worker that is still running the previous build is how
a false "verified" result gets produced, so the runtime treats it as a fault:

- at startup a source file newer than the build output that would be loaded, or
  a missing build output, **aborts the process** with the offending file and the
  exact rebuild command;
- while running, a rebuild of `apps/studio-agent-runtime/dist` or
  `packages/shared/dist` underneath the process logs `ERROR` and turns `/ready`
  into `503 stale` — the process is alive, its code is out of date, restart it.

Both checks are `stat`-only and compare exactly the two build outputs the process
loads. In the production image no source tree exists, so the source comparison
reports itself as skipped instead of guessing.

Temporal SDK metrics use its Prometheus exporter at
`STUDIO_AGENT_METRICS_BIND_ADDRESS` (default `0.0.0.0:9464`). The Helm chart
publishes the named pod port but deliberately does not invent a public
Service or `ServiceMonitor`; the cluster's existing private pod-scrape
integration must select it.

## Graceful shutdown

Temporal's Node runtime owns `SIGINT`, `SIGTERM`, `SIGQUIT`, and `SIGUSR2`.
This application observes the same signals to make readiness fail immediately;
Temporal then stops polling and drains in-flight workflow/activity tasks.

`STUDIO_AGENT_WORKER_SHUTDOWN_GRACE_MS` is the graceful cancellation window.
`STUDIO_AGENT_WORKER_SHUTDOWN_FORCE_MS` is the hard SDK deadline and cannot be
shorter. Kubernetes `terminationGracePeriodSeconds` must be strictly longer
than the force deadline. The Helm template enforces that relationship and the
image declares `SIGTERM` as its stop signal.

## Container and Helm deployment

The image is multi-stage, runs as UID/GID `1001`, and includes a Docker
healthcheck against `/ready`. The Helm workload adds:

- separate control and activities Deployments and PodDisruptionBudgets;
- rolling updates with `maxUnavailable: 0`;
- non-root, read-only-root-filesystem, no-capabilities, RuntimeDefault seccomp;
- startup, readiness, and liveness probes;
- role-specific resource and concurrency limits;
- least-privilege secret projections.

`studioAgentRuntime.enabled` is `false` by default. The repository does not
provision a fake Temporal cluster. Before enabling the chart, operators must
provide a real production namespace and mTLS endpoint, publish an immutable
runtime image, and provision:

| Kubernetes Secret                          | Consumers                   | Required keys                                              |
| ------------------------------------------ | --------------------------- | ---------------------------------------------------------- |
| `fizzdragon-studio-agent-temporal-secrets` | Server, control, activities | `TEMPORAL_TLS_CA`, `TEMPORAL_TLS_CERT`, `TEMPORAL_TLS_KEY` |
| `fizzdragon-studio-agent-gateway-secrets`  | Server, activities          | `STUDIO_AGENT_RUNTIME_TOKEN`                               |
| `fizzdragon-studio-agent-model-secrets`    | Activities only             | `ALIBABA_API_KEY`                                          |

On Azure, the chart projects those three Secrets from three scoped Key Vault
`SecretProviderClass` resources. On the CN cluster, where Azure CSI is
disabled, the same Kubernetes Secrets must be created by the existing
out-of-band secret delivery mechanism before rollout.

The release and image tag must both be immutable deployment revisions; the
chart rejects `set-at-deploy` and `latest`. The server, control worker, and
activities worker must receive the same Temporal namespace, queue contract,
Worker Deployment name, release build ID, and service token.

Runtime egress is default-denied. Kubernetes NetworkPolicy cannot match an
external service by DNS name, so operators must provide the exact
environment-specific Temporal and model-provider CIDRs in
`studioAgentRuntime.networkPolicy`. Missing CIDRs, disabled policy, and broad
catch-all/private-network CIDRs fail Helm rendering. The allow policies expose
only DNS, Temporal, the in-namespace Nest gateway, and the model-provider
endpoint required by each worker role.

## Worker Deployment versioning

Both worker roles register the same stable Temporal Worker Deployment and the
same immutable release build ID. The default workflow versioning behavior is
`PINNED`, and Nest starts a workflow with an explicit `pinnedTo` override only
after it observes fresh workflow and activity pollers for that exact
deployment/build pair.

Every release gets release-specific Kubernetes Deployment and
PodDisruptionBudget names. Helm marks them `keep`, so upgrading the chart
starts the new build without deleting workers still needed by older pinned
histories. This retention is intentional: deleting a previous control or
activity worker based only on deployment age can strand an open workflow.

Nest does not wait for Temporal during application bootstrap. Strict
configuration still fails synchronously, while connection, worker discovery,
and bounded exponential reconnect run in the background. The public
availability contract reports `starting`, `ready`, or `degraded`; Story Studio
enables submission only while both release pollers are operational. An
unavailable runtime therefore delays outbox delivery without taking unrelated
Nest APIs offline.

## Deployment runbook

1. Provision the production Temporal namespace, mTLS client identity, and
   narrow Temporal/model endpoint CIDRs. Verify connectivity from both server
   and worker node pools.
2. Create or rotate the three scoped Secrets above. Secret values are process
   environment variables and do not hot-reload; rotation requires a rollout.
3. Publish the runtime image using the exact source revision as both image tag
   and `studioAgentRuntime.release`.
4. Apply database migrations and deploy the Nest control plane that understands
   the same `@repo/shared/studio-agent` contract.
5. Enable `studioAgentRuntime` and apply the release. Keep the prior
   release-specific worker Deployments running. Confirm every new pod's
   startup and readiness probes and both exact-release Temporal task-queue
   pollers. Nest will keep availability degraded and will not dispatch a new
   pinned workflow until both pollers are fresh.
6. Exercise one no-write run, one approval-gated action, steering, cancellation,
   and reconnect/replay from the event sequence. Confirm the command outbox has
   no dead letters before completing the release.

Rollback restores the previous immutable release in the server values; its
kept control and activity workers are already available for histories pinned
to that build. New starts remain unavailable until Nest observes both pollers
for the restored build.

Retire a kept release only after Temporal reports no open workflow execution
pinned to its Worker Deployment version and no retained task remains for
either queue. Then delete that release's two Deployments and two
PodDisruptionBudgets together. A workflow migration must be an explicit,
tested Temporal operation; never relabel, rename, or silently route an
existing history to different code.

Queue names and shared wire contracts are versioned boundaries. A breaking
queue/schema change requires a new queue/contract version and a coordinated
server/runtime rollout, not an in-place rename.

## Running it locally

Two prerequisites, both outside this app: a Temporal dev server
(`temporal server start-dev`, which listens on `127.0.0.1:7233`) and the Nest
control plane (`npm run dev -w server`) if you want the activities role to do
anything. Then copy [`.env.example`](./.env.example) to `.env` and fill it in —
`TEMPORAL_TLS_MODE=disabled` is the deliberate local plaintext opt-in.

```bash
npm run dev -w studio-agent-runtime              # both roles
npm run dev:control -w studio-agent-runtime      # one role
npm run dev:activities -w studio-agent-runtime
```

That single command is the whole procedure, and it is one command on purpose:

1. loads `.env` exactly as the workers will and prints what it contributed;
2. compiles `@repo/shared` with `tsc --watch` and **starts nothing until that
   first build succeeds** — the workers load its build output, not its sources;
3. validates the configuration of every role about to start, including that the
   two roles cannot collide on a health port or metrics bind address, and starts
   nothing if it does not hold;
4. runs each worker under `tsx watch`, watching this app's `src` and
   `packages/shared/dist`, so an edit in either place restarts the worker that
   loaded it;
5. polls each `/ready` and prints every role state transition, so
   "half of the stack is up" is visible instead of assumed;
6. takes the whole stack down together — on Ctrl-C, and on any child exiting.

Output is line-prefixed per process (`[shared]`, `[control]`, `[activities]`,
`[dev-stack]`).

Do not pin `STUDIO_AGENT_HEALTH_PORT` or `STUDIO_AGENT_METRICS_BIND_ADDRESS` in
`.env`: one file feeds both roles, so a pin makes the second worker fail to bind.
Each role has its own default instead.

To run compiled output the way production does, build first — the worker refuses
to start against a stale or missing build and tells you which command to run:

```bash
npm run build -w studio-agent-runtime
npm run start:control -w studio-agent-runtime
```

Repository checks:

```bash
npm run check-types -w studio-agent-runtime
npm run lint -w studio-agent-runtime
npm run test -w studio-agent-runtime
npm run build -w studio-agent-runtime
helm lint deploy/helm/fizzdragon
bash deploy/helm/fizzdragon/tests/studio-agent-runtime-render.sh
```

## Durable interaction semantics

- `steer` cancels the active model/child activity, consumes the new input, and
  resumes the same root run.
- `enqueue` waits for the active root run to terminate, then promotes the
  oldest queued input to a new root run.
- `stop_and_send` cancels the active root run and promotes the supplied input
  to a new root run.
- Direct actions are bounded, idempotent transactions. Long-running work is a
  cancellable child run.
- Preparing a child run settles either way: `started` carries the descriptor the
  workflow must run, `refused` carries the terminal `failed` action the control
  plane recorded for an input the capability manifest rejected. A refusal starts
  no child — the model reads it back as a tool result and corrects the call, and
  it counts against the same per-turn correction budget as any other rejection.
- Approval decisions atomically resolve Approval and Action. Timeout uses
  `expired`; supersession uses `cancelled`.

Canonical control-plane terminal transitions atomically clear the thread's
active root run and cancel any still-pending approvals/actions for that run.
