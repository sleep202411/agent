# Operations

## Release order

1. Build and scan three immutable images with Node 24 (the production
   Dockerfile is pinned to the published `24.18.0-bookworm-slim` patch) and npm
   `11.16.0`: the API from `.mastra/output/`, the Worker from
   `.temporal/worker/`, and the migrator from `.migrations/agent-memory/`. Scan
   each artifact's own lockfile; do not infer production exposure from the
   monorepo-wide development tree.
2. Apply the product database migration that owns conversation, attachment,
   domain-command, and invocation-lifecycle tables before routing any new
   platform traffic.
3. Create the distinct `LOGIN NOINHERIT`, non-owner PostgreSQL roles named by
   `AGENT_MEMORY_API_DATABASE_ROLE` and
   `AGENT_MEMORY_WORKER_DATABASE_ROLE`, then run the immutable
   `.migrations/agent-memory` artifact with a third owner/migrator credential.
   Its build verifies the complete checked-in Mastra DDL against the pinned
   `@mastra/pg` adapter. It grants the API role `SELECT` only, grants the Worker
   role framework-table DML and sequence usage, and leaves the migration ledger
   read-only to both. The migration refuses runtime roles that are missing,
   administrative, members of another role, or owners of the schema or its
   objects. Each process must authenticate as its configured
   `AGENT_MEMORY_DATABASE_ROLE`.
4. Apply the versioned ClickHouse observability schema that matches the pinned
   OpenTelemetry Collector release. This belongs to the observability
   infrastructure release, not the Agent process.
5. Deploy the pinned Collector configuration and wait for its receiver,
   persistent queue, exporter, and disk alerts to be healthy.
6. Grant the Worker's Google principal `roles/aiplatform.user` on the configured
   project. On Google Cloud, attach a user-managed service account. On
   Azure/Alibaba Cloud, configure Workload Identity Federation and point
   `GOOGLE_APPLICATION_CREDENTIALS` at the generated external-account
   configuration. Never create a service-account private-key file.
7. Deploy the API replicas without exposing them to public ingress.
8. Deploy the new Temporal Worker Deployment version using the same immutable
   `AGENT_RELEASE`.
9. Make the Worker Deployment version eligible/current according to the
   Temporal rollout policy.
10. Wait for `/api/v1/health/ready` to report all dependencies ready.
11. Shift traffic gradually and observe errors, latency, Workflow backlog, model
    throttling, and Ably run completion.

The repository's AKS deployment helper builds the three image targets
atomically with one immutable Git SHA:

```bash
deploy/deploy-com-aks.sh agent-platform
```

Before changing `agentPlatform.enabled` to `true`, provision every
`agentPlatform*Secrets` entry declared in the Helm values, publish the Server
signing key's public JWK through its generated JWKS endpoint, and publish both
Agent domain-signing public JWKs in the Server's domain JWKS. The chart rejects
mixed image revisions, fewer than three API replicas, too-short Worker shutdown
grace, and an external plaintext Temporal endpoint.

Each key in that domain JWKS carries a required `fizzdragon_capability` member,
either `readiness` or `runtime`. **The API's key must be `readiness` and only
the Worker's key may be `runtime`.** The Domain Gateway admits a `readiness`
credential on readiness routes only; every business-mutation route requires
`runtime`. This claim is what makes the process boundary in
[architecture.md](architecture.md) real — the API holds a domain signing key
solely so it can prove liveness, and the capability is the only thing stopping
that key from executing tools. A JWKS that omits the member is rejected at
boot, which is safe. A JWKS that marks **both** keys `runtime` boots cleanly
and silently returns full tool-execution authority to the API. Verify the
published set before enabling, and again after any key rotation.

Do not grant ClickHouse credentials to the API or Worker. Do not run schema
migration in API, Worker, or Collector startup. Do not reuse a build ID for
different code.

The Worker artifact is deliberately independent from the monorepo and API
artifact. It starts with `npm start` from its artifact root and does not receive
API-only authentication, port, or health-probe environment variables.
Conversely, the API does not receive a model-provider credential and cannot
construct the executable Agent. The one-shot migrator is the only process that
receives `AGENT_MEMORY_MIGRATION_DATABASE_URL`; the two non-secret role names
are provided only to bind grants. API and Worker each receive their own
`AGENT_MEMORY_DATABASE_ROLE` and matching connection credential.

The Worker requires `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`,
`AGENT_INTERACTIVE_MODEL_ID`, `AGENT_REASONING_MODEL_ID`, and
`AGENT_MEMORY_OBSERVER_MODEL_ID`. The interactive model owns greetings,
focused edits, and ordinary tool turns; the reasoning model is selected
deterministically for source-material and deep-analysis turns without an
additional classifier-model request. Model IDs are unprefixed Gemini IDs
because the code selects the Vertex provider explicitly.
`GOOGLE_VERTEX_API_KEY` is forbidden and causes boot to fail. Before polling
Temporal, every Worker verifies that ADC can issue a short-lived Cloud Platform
token and that Agent Memory and the domain gateway are ready. A broken identity
therefore fails during rollout, not on a creator's first invocation.

Worker Deployments are release-versioned and retained so Temporal's `PINNED`
histories never lose their compatible code during a rollout. After Temporal
reports that an old build has no pinned or open executions, delete that
release's retained Deployment and PodDisruptionBudget explicitly. Turning the
migration switch off stops new Server traffic but intentionally does not kill
retained Workers that are still draining.

CI must run `npm run test:security` after `npm run build` and block every high or
critical production advisory. Moderate and low upstream advisories remain
visible in the report and require an explicit reachability assessment plus an
upgrade/removal owner; they must never be hidden by disabling audit.
Development-only lifecycle scripts are explicitly reviewed and version-scoped
through `allowScripts`. Production API and Worker artifacts install with
scripts disabled and record explicit denials for every transitive dependency
that declares one; artifact smoke tests must prove those scripts are not
required at runtime.

## Required production topology

- at least three API replicas across failure domains
- Worker replicas across failure domains with independent capacity headroom
  for workflow, control, inference, tool, lifecycle, cleanup, and document
  queues
- at least three Collector replicas across failure domains
- persistent Collector queues on encrypted, capacity-monitored volumes
- replicated ClickHouse with retention controls
- highly available Temporal namespace and task queue
- highly available product PostgreSQL for conversation state, the invocation
  admission outbox, and lifecycle projection, with PITR and tested restore
- highly available PostgreSQL for the isolated `agent_memory` schema, with
  PITR, tested restore, connection-pool headroom, and separate API-read,
  Worker-write, and migrator-owner roles
- product JWTs with a maximum 15-minute lifetime and Ably token auth for clients
- an Ably channel rule on namespace `agent` (covering
  `agent:v1:conversation:*`) with **Message annotations, updates, deletes, and
  appends** (`mutableMessages: true`) enabled; AI Transport token streaming
  cannot operate without it, and the rule implies message persistence
- service credentials from a secret manager, never image or environment files
- private ingress exposing only invocation, cancellation, and health routes to
  the authenticated product gateway
- distributed admission control at ingress, with global, tenant, and actor
  quotas applied before a Temporal Workflow is started

Admission limits must be shared across API replicas and return `429` with a
bounded `Retry-After`. Do not add a process-local rate limiter: it becomes
inconsistent during scaling and failover. Capacity limits must protect the
Temporal task queue, model-provider quota, Ably publish budget, and domain
gateway together.

## Health semantics

`/api/v1/health/live` reports only process liveness.

`/api/v1/health/ready` checks the Collector process, Temporal, the Mastra
storage migration/role baseline, and the domain gateway in parallel. Results
are cached for five seconds to avoid a probe storm. Temporal, storage, and the
domain gateway are critical; their failure removes the replica from service.
The Collector is noncritical, so its outage is reported as degraded without
turning a telemetry outage into a product outage.

The API does not possess an Ably credential and does not probe Ably. An input
event has already been published before admission; once the product outbox
reserves it, Temporal must durably wait through an Ably outage instead of
rejecting admission. Monitor Ably through Worker activity failures, provider
metrics, and an external synthetic run.

The Worker exposes `/health/live` and `/health/ready` on its dedicated health
port. Readiness is true only while the Temporal Worker is running and neither
the Workflow nor Activity poller has failed; graceful shutdown removes the pod
from service before it stops. The official Temporal SDK Prometheus exporter
serves `/metrics` on a separate metrics port. The health and metrics listeners
are required to use different ports and a configuration collision fails at
boot.

The Collector health extension reports process/pipeline lifecycle, not
ClickHouse delivery health. Alert separately on Collector refused records,
queue occupancy, enqueue failures, export failures, retry age, persistent-volume
usage, and ClickHouse replica health.

## SLO and alerts

Target service availability is 99.99% (about 4 minutes 23 seconds of monthly
unavailability in a 30.44-day month). Define separate indicators for:

- invocation accepted successfully
- accepted invocation reaches running or a durable terminal projection
- first visible assistant output latency
- cancellation acknowledgement and active-Activity stop latency
- run terminal-event completeness
- tool command success/rejection latency
- reconnect recovery success

Page before the error budget is exhausted on:

- accepted invocation without `run-start` or a durable terminal projection
- oldest due admission-outbox row, lease reclaim rate, repeated delivery
  attempts, and `admitting` age
- Run opened without terminal/suspend event past its deadline
- Temporal schedule-to-start latency or backlog by execution lane (never only
  the base queue aggregate)
- session invocation queue depth, rejected admissions, Update latency, and
  Continue-As-New failures
- Agent Memory pool saturation, query latency, migration drift, and replication lag
- repeated Activity attempts by failure type
- document-analysis age, per-stage backlog, incomplete source coverage, and
  checkpoint retry rate
- cancellation Update failures, Activity cancellation latency over one second,
  and opened Runs missing terminal cleanup after cancellation
- domain idempotency conflicts
- model 429/5xx rate
- invocation admission rejection and global/tenant quota saturation
- Ably publish/attach failures
- Collector refused/export-failed records or persistent queue saturation
- ClickHouse saturation, replication lag, or unavailable replicas
- readiness dependency flapping

## Recovery drills

Regularly test:

- kill API after Workflow start
- kill the product gateway after Agent admission but before its HTTP response;
  verify another replica reclaims the lease and the Workflow observes one
  invocation
- make the Agent API unavailable during submission; verify the product returns
  the stable durable identity, then admits it automatically after recovery
- kill Worker during model stream and tool call
- disconnect a client and reconnect on another device
- cancel an active model call and verify the Activity stops, the Ably Run
  terminalizes, and the same session processes its next invocation
- cancel an invocation while another invocation owns the session, and verify
  the queued invocation never opens an Ably Run
- publish only the Ably cancellation path, then only the Temporal cancellation
  path, to prove each failure mode converges safely
- repeat the same invocation and tool idempotency key
- send a steer during inference and verify the queued duplicate becomes a no-op
- kill a Worker before and after Agent Memory persistence, then verify no
  duplicate assistant response is generated
- revoke permission between inference and execution
- deploy incompatible Workflow code and confirm pinned runs stay compatible
- take ClickHouse offline, verify Agent traffic remains healthy, and verify the
  Collector persistent queue survives restarts and drains after recovery
- take the Collector endpoint offline and verify readiness reports degraded
  observability without removing the Agent replica
- temporarily deny domain gateway and model provider connectivity
- saturate inference and document queues independently, then prove admission,
  Stop, lifecycle projection, and cleanup remain responsive
- kill document Workers during map and reduce stages, then prove completed
  artifacts are reused and final source coverage remains exhaustive

## Data and privacy

The export formatter removes span input/output, system instructions, provider
options, stack traces, and raw error messages. The observability filter also
redacts common secret fields and bounds serialized payload sizes. Callers must
still avoid putting credentials, full documents, or sensitive business payloads
into custom trace attributes. Logs contain stable IDs and error codes, not
prompts or model responses.
