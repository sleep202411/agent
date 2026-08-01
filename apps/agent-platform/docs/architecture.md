# Architecture

## Application boundary

The Agent Platform is an independently locked and released application inside
the repository, not a package in the legacy npm workspace. Its dependency tree
cannot be hoisted into `apps/agent`, and legacy ranges cannot change the
platform's resolved Mastra, Temporal, Ably, or AI SDK versions. CI installs and
verifies both dependency graphs in separate jobs.

The deployable process boundary is narrower than the source application:

- the API verifies gateway JWTs, reads Agent Memory history, checks
  dependencies, and performs Temporal admission;
- the Worker alone constructs the executable Mastra Agent and its explicit
  Google Vertex AI SDK models, then obtains short-lived OAuth tokens through
  Application Default Credentials;
- the migrator alone receives the DDL-capable Mastra storage credential and
  grants the API role read-only access and the Worker role DML-only access.

The API therefore cannot invoke a model, open an Ably run, or perform a business
mutation even if it is compromised. API, Worker, and migrator images are built
from independent self-contained artifacts and run as non-root processes.
The API artifact does not contain the Vertex provider or Google authentication
library. It constructs memory without Observational Memory processors; the
Worker mounts the Vertex-backed Observer when it constructs the executable
Agent.

## One agent, capability-scoped sessions

FizzDragon is a single product identity. Separate page-specific agents would
fragment memory, behavior, safety policy, observability, and user experience.
Instead, the product gateway signs an `agent_context` containing:

- actor and a surface-specific business scope
- product surface
- Ably session name
- Story workspace plus project, or an independent crew scope
- locale
- roles and permissions
- trace ID

The Agent Platform verifies the JWT and maps that context into Mastra
`RequestContext`. The capability registry is deny-by-default: both surface and
permission must match. A prompt injection cannot change either.

## Invocation sequence

```mermaid
sequenceDiagram
  participant UI as Product UI
  participant A as Ably AI Transport
  participant G as Product gateway
  participant P as Product PostgreSQL
  participant API as Agent API
  participant T as Temporal
  participant M as Mastra Agent
  participant D as Domain gateway

  UI->>G: open scoped agent session
  G-->>UI: short-lived JWT + Ably token
  UI->>A: publish input
  UI->>G: inputEventId + causal message ID
  G->>P: reserve stable invocation/run aggregate + durable attempt, claim lease
  G-->>UI: 202 + durable invocation ID
  Note over G,API: admission is an outbox; the request path never calls the Agent API
  loop until admitted or durably rejected
    G->>P: SKIP LOCKED claim + current authorization
    G->>API: pointer + aggregate IDs + attempt ID/ordinal + fresh signed context
    API->>T: Update-With-Start deterministic session Workflow
    Note over T: attempt dedupe + ordinal validation + bounded FIFO queue
    alt admitted
      API-->>G: accepted
      G->>P: status = queued, clear lease
    else bounded session queue is full
      API-->>G: 429 AGENT_SESSION_QUEUE_FULL
      G->>P: status = rejected + retryable public error, clear lease
    else Agent timeout, 5xx, or ambiguous response
      G->>P: schedule leased redelivery with same IDs
    end
  end
  T->>A: open/adopt run
  T->>D: signed lifecycle = running
  D->>P: monotonic lifecycle projection
  T->>M: one inference Activity
  M->>M: reconcile current-run delta with PostgreSQL memory
  M-->>A: AI SDK v6 stream in stable step
  alt server tool
    T->>D: execute with stable idempotency key
    D-->>T: succeeded or structured rejected
    T-->>A: tool-output-available
    T->>M: next inference Activity
  else approval or client tool
    T->>A: suspend run
  else complete
    T->>A: terminal complete
  end
  T->>D: signed terminal/suspended lifecycle
  D->>P: persist reconnect-safe outcome
```

Admission is durable rather than synchronous: submission always answers `202`
once the aggregate row exists. A bounded-queue rejection therefore reaches the
client as a `rejected` status carrying a retryable public error on the durable
invocation projection, never as a `429` on the submitting request.

Cancellation deliberately follows two paths. The UI first calls Ably
`run.cancel()` so an attached AgentSession sees the user's intent with realtime
latency. It then asks the product gateway to cancel the accepted
`invocationId`; the gateway re-authorizes the session and sends a signed request
to the Agent API, which executes a Temporal Workflow Update. The Update marks a
queued invocation so it never starts, or cancels the active invocation's
`CancellationScope`. Remote Activities receive cancellation through heartbeat
responses. Worker heartbeat throttling is capped at one second so the default
Temporal throttle cannot turn the Stop button into a tens-of-seconds wait.

The two paths are complementary rather than interchangeable. Ably owns
realtime run protocol behavior and handles cancellation that races ahead of run
creation. Temporal owns durable execution state and still records cancellation
when a browser disconnects, a realtime publish is lost, or the invocation is
waiting in the session queue. Terminal Ably cleanup runs in a non-cancellable
scope after an opened run, and so does every product lifecycle transition: a
Stop cancels the model and tool chain, never the durable transition — or the
projector Workflow — that every reconnecting client depends on. A pre-start
cancellation does not fabricate a
`run-end`, because Ably's run lifecycle cannot end before it starts. Instead,
the Worker records a signed `cancelled` lifecycle transition in the
product-owned invocation projection. Studio polls that lightweight projection
while work is in flight and merges it with Ably's read model.

An approval response is a new durable **attempt** for the same product
invocation/run aggregate and long-lived session Workflow. Every attempt has a
stable UUID and monotonic ordinal. Attempt zero is the root; ordinal `n + 1` is
admitted only after ordinal `n` reached `waiting_for_approval`. It adopts the
suspended Ably Run, uses the attempt ID for Ably Invocation/Step identity,
executes only approved pending server tool calls, and resumes inference. This
prevents a continuation from colliding with, or being deduplicated as, the
original transport attempt while preserving one product-visible run. Steering
is different: it is published directly into the active Ably Run and aborts only
the current provider call.

Every lifecycle request and acknowledgement carries the complete
`invocationId + attemptId + attemptOrdinal` tuple. The invocation and run IDs
remain stable product identities; the attempt tuple lets PostgreSQL reject late
callbacks from an older continuation without moving lifecycle state backwards.

The Workflow carries bounded recent-attempt identities and per-aggregate
attempt cursors through Continue-As-New. It continues proactively or when
Temporal recommends it, and also moves to a new compatible Worker Deployment
version through Continue-As-New. A single invocation failure is terminalized
and logged, then the session processes its next queued command.

## Isolated execution lanes

One deployment-owned base task queue derives seven independently scalable
lanes:

| Lane      | Work                                                       |
| --------- | ---------------------------------------------------------- |
| workflow  | Interactive session and lifecycle-projector Workflow tasks |
| control   | Ably Run adoption/open                                     |
| inference | Model generation and streaming                             |
| tool      | Authorized domain tool execution                           |
| lifecycle | Product lifecycle projection                               |
| cleanup   | Non-cancellable terminal Ably cleanup                      |
| document  | Long-document Workflow plus analysis Activities            |

Inference saturation therefore cannot starve Stop, lifecycle, or cleanup work,
and a large screenplay cannot consume the interactive conversation pool. Each
lane has an explicit concurrency budget and appears independently in Worker
health and Temporal queue metrics.

Lifecycle projection runs in one abandoned child Workflow per product
invocation aggregate. The session Workflow waits only for Temporal to record a
child start or signal, never for the product gateway HTTP call. The child
preserves transition order, retries with bounded Activities, and
continues-as-new during a prolonged gateway outage. Lifecycle infrastructure
failure therefore cannot head-of-line block the next conversation turn.

Repair is bounded in both directions. A transition the product refuses
permanently — an unknown, never-admitted, or already-terminal aggregate — is
abandoned with a diagnostic instead of being redelivered forever, and the child
carries an execution timeout so an approval the user never answers cannot leave
an open Workflow behind.

## Large-document analysis

Source documents are normalized and indexed by the product service before
analysis. Raw text never enters Temporal history. A dedicated document
Workflow carries only immutable job, chunk, and artifact identities:

1. claim the durable job and immutable manifest;
2. map bounded source sections in controlled parallel batches;
3. tree-reduce persisted, evidence-carrying artifacts with bounded fan-in;
4. require complete source-chunk coverage before finalization;
5. atomically publish the final artifact, or a safe structured failure whose
   delivery carries its own long-lived retry budget.

Every Activity is heartbeat-cancellable and every artifact write is
idempotent. Completed artifacts are checkpoints, so Worker loss or Activity
retry resumes without regenerating successful sections. The bounded
200,000-character/256-section contract comfortably covers a 60–70k Chinese
character screenplay while keeping model inputs, outputs, database payloads,
and Workflow history within explicit limits.

## State ownership

| State                                                | Authority                   | Reason                                            |
| ---------------------------------------------------- | --------------------------- | ------------------------------------------------- |
| Story graph, crew, tasks, permissions                | Business service database   | Transactional business truth                      |
| Workflow execution and retries                       | Temporal event history      | Durable deterministic control                     |
| Live conversation tree and run/step lifecycle        | Ably AI Transport           | Reconnectable realtime UX                         |
| Invocation admission outbox and lifecycle projection | Product PostgreSQL          | Durable handoff and reconnect-safe UI outcome     |
| Mastra framework state and Agent memory              | PostgreSQL `agent_memory`   | Persistent framework contract and bounded context |
| Traces and logs                                      | OTel Collector → ClickHouse | Isolated operational telemetry                    |
| Model output                                         | Never authoritative         | Proposal until a domain tool succeeds             |

No component reconstructs another component's truth by scraping logs. Mastra
storage is explicitly non-authoritative for business state: deleting it loses
framework metadata and conversation recall, not a story graph, crew,
permission, billing record, or tool receipt. Its schema is migration-owned; the
API role is read-only, the Worker role receives DML but no DDL, and readiness
rejects a connection authenticated as the wrong role.

Ably is reconciled at the current-run boundary. Identical message IDs already
stored under the signed thread/resource are omitted; changed tool-state
messages are upserted; an ID found under another security partition is a hard
integrity failure. Mastra Observational Memory supplies bounded historical
context instead of replaying the full Ably branch on every model step.

## Why direct Temporal SDK

The installed `@mastra/temporal` package is experimental. The critical runtime
uses the stable official Temporal TypeScript SDK directly. Mastra still owns
agent execution; `@mastra/ai-sdk` performs the official AI SDK v6 stream
conversion consumed by Ably.

## Why an OpenTelemetry boundary

The Agent process exports OTLP/HTTP Protobuf to an OpenTelemetry Collector. It
never opens a ClickHouse connection and never performs telemetry schema work.
The Collector owns durable queues, retry, batching, and backend delivery; the
ClickHouse schema is managed as versioned observability infrastructure.

This boundary is also a privacy boundary. Mastra span input/output, system
instructions, provider options, stack traces, and raw error messages are removed
before OTLP export. Operational identifiers, timings, token usage, capability
names, and stable error codes remain observable.

## Failure behavior

| Failure                            | Behavior                                                    |
| ---------------------------------- | ----------------------------------------------------------- |
| Duplicate invocation HTTP request  | Product reservation and Workflow state deduplicate it       |
| Gateway dies during Agent response | Expired DB lease redelivers the same stable invocation IDs  |
| Agent unavailable at submission    | Product returns durable 202; outbox retries with fresh auth |
| Outbox attempt budget exhausted    | Attempt dead-letters and releases its reserved capacity     |
| Approval left unanswered           | Product timeout terminalizes it and releases its capacity   |
| Queue at its configured bound      | Admission returns HTTP 429; session Workflow stays healthy  |
| Invalid attempt ordinal            | Admission returns HTTP 409; aggregate state does not move   |
| Failure before Ably `run-start`    | Signed lifecycle row terminalizes and unlocks every client  |
| Steering during model output       | Ably interrupts only that model step; no new invocation     |
| Approval continuation              | Enqueued and consumed serially by one session Workflow      |
| Model/provider transient failure   | Temporal retries the same Activity and Ably Step            |
| Business gateway 5xx/timeout       | Activity retry; idempotency key remains stable              |
| Lifecycle gateway unavailable      | Child repairs in order; the session queue keeps moving      |
| Business rejection 403/409/422     | Published as structured tool output; model corrects         |
| Permission removed mid-run         | Domain service returns a current authorization rejection    |
| Worker terminated                  | Temporal schedules work on a compatible pinned Worker       |
| Client disconnects                 | Run continues; Ably reconnect restores ordered history      |
| Stop during active invocation      | Ably fast path plus Temporal Update cancel the Activity     |
| Stop while invocation is queued    | Temporal records cancellation and never starts the Run      |
| Cancellation after Run open        | Non-cancellable terminal Activity ends the Ably Run         |
| One invocation exhausts retries    | Run ends with error; the session continues its queue        |
| Worker loss during document map    | Checkpoints persist; only missing units retry               |

## Availability

The design removes single-process state and supports a 99.99% service SLO, but
an SLO is an operational commitment, not a property a codebase can claim alone.
It requires multi-zone replicas, highly available Collectors with persistent
queues, replicated ClickHouse, highly available Temporal and Ably connectivity,
capacity headroom, safe Worker Deployment rollout, and tested incident
response.
