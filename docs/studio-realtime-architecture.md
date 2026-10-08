# Studio realtime architecture

This document describes the current self-hosted realtime path. PostgreSQL owns
application state and durable events; WebSocket delivery makes clients update
promptly. A connected socket does not by itself establish complete state,
exactly-once delivery or a measured availability target.

## Transport and authorization

The `.com` Server runs on Singapore ACK with Redis and PostgreSQL in that cell.
CN uses its own deployment and datastores. `REALTIME_TRANSPORT=self-hosted` and
`REALTIME_WS_SECRET` are required; Azure Web PubSub is retired. Runtime values
come from the regional Kubernetes Secrets. Current deployment instructions are
in the [Singapore runbook](../deploy/aliyun-sg/README.md).

The browser negotiates through authenticated Server HTTP routes:

| Route                                              | Scope                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `POST /aurora/realtime/negotiate/entity`           | The authenticated user's entity updates                            |
| `POST /aurora/realtime/negotiate/assets`           | The user asset stream, or an authorized workspace asset stream     |
| `POST /aurora/realtime/negotiate/realtime`         | Unified Studio user, workspace and optional Story project channels |
| `GET /aurora/realtime/replay?channel=…&afterSeq=…` | Authorized replay of one channel                                   |

Workspace negotiation requires viewer access. A requested Story project also
requires the matching workspace and `story.read`. Replay rechecks current
access; possession of an earlier channel name does not grant replay permission.

Negotiation returns `{url, accessToken, expiresAt, transport:"self-hosted"}`. The
HMAC-signed token contains user identity, permitted groups and an expiry; current
TTL is one hour. The browser opens `/aurora/ws/realtime?token=…`. Ingress strips
`/aurora`, preserves WebSocket upgrades and forwards to Nest's `/ws/realtime`.
Use HTTPS/WSS and omit credential-bearing query strings from access logs.

The gateway verifies the token and joins only its listed groups. It accepts
keepalive pings, not arbitrary client publications or dynamic subscription
commands. Access-revocation messages close affected sockets; reconnect negotiates
again against current permissions. Expired and idle sockets close. The current
limit of 50 sockets per user is per Server process, not an account-wide rate
limit.

## Publication and durability

```text
Domain mutation + durable outbox row (PostgreSQL transaction)
  → outbox dispatcher
  → Redis group publication
  → Server gateway pods
  → authorized local WebSocket clients
  → client refetch of canonical application state
```

`enqueueRealtimeEvent` allocates a monotonically increasing sequence per channel
and stores the event in the caller's database transaction. Published envelopes
include `channel`, `seq` and `eventId`. There is no global order across channels;
consumers must not infer one from arrival time. Retried dispatch can produce
duplicate deliveries.

The outbox dispatcher retries delivery and records dispatch state. Dispatched
rows are eligible for cleanup after seven days. Redis Pub/Sub is a live fan-out
path, not durable storage or a replacement for replay. Each gateway currently
pattern-subscribes to realtime groups and filters locally to its connected
clients; this is not a sharded per-channel subscription implementation.

User channels cover assets and entitlements. Workspace channels cover assets,
wallet, entitlements, team and projects. Story-project channels use project
permissions. Legacy job/media messages without channel sequence fields still
exist; they do not receive the newer ordered replay guarantee.

## Client connection and recovery

Studio's `AssetsRealtimeKernel` shares one socket for each active
workspace/Story-project scope. The first subscriber opens it, the last closes it,
and late subscribers receive the current connection state. It serializes
processing per channel, tracks the last delivered sequence and bounds the set of
seen event IDs. Old or duplicate sequenced events are discarded.

When a later event reveals a sequence gap, the kernel requests replay before
processing that event. Replay defaults to 200 events per page, with a Server
maximum of 500; the client bounds catch-up to 50 pages. Replay does not replace
an initial REST snapshot. It also cannot recover messages already cleaned up,
legacy unsequenced messages or an idle channel whose last event was missed and
which receives no later push.

On replay failure or an excessive backlog, consumers must converge through their
canonical queries. Mount, reconnect/focus refresh and existing HTTP recovery
paths remain necessary. Subscribers that apply deltas without a state refetch
need an explicit recovery contract; they cannot assume the existing kernel
provides a lossless event log. Closing the last subscriber clears sequence state;
a later mount obtains current application state again.

Initial connection failures and reconnects use the same exponential backoff,
full jitter and cooldown path. Each retry negotiates fresh access. Heartbeats
keep idle connections observable. On graceful Server shutdown the gateway sends
a reconnect control frame and closes sockets; clients reconnect through their
normal close handler. This is recovery from interruption, not an uninterrupted
session guarantee.

## Failure behavior and operational checks

| Failure                            | Expected recovery                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| Browser offline or gateway restart | Reconnect, reauthorize, then refetch current state; sequenced gaps can replay         |
| Redis publication unavailable      | Durable producers retain outbox work for retry; clients use their state recovery path |
| PostgreSQL unavailable             | State writes and replay can fail; the socket cannot substitute for database truth     |
| Permission removed                 | Revocation closes live access; negotiation and replay enforce current permissions     |
| Replay window exceeded             | Fetch a current snapshot; do not apply an incomplete delta history                    |
| WebSocket upgrade blocked          | Diagnose edge/ingress routing and retain the consumer's HTTP recovery behavior        |

For a release, check the authenticated negotiate route, WebSocket upgrade,
workspace/project access denial, revoke behavior, state refetch after a reconnect
and a sequenced replay gap. Multi-pod delivery, Redis interruption, slow-client
pressure and load capacity require environment tests. Unit fixtures do not prove
those production properties. Replica counts, rollout settings and Redis capacity
must come from the current regional resources, not historical AKS/HPA values.

Monitor connection/reconnect errors, denied negotiation, Redis health, outbox
backlog and dispatch failures, replay failures and client state-refresh errors.
There is no measured 99.99% SLO or 10,000-socket-per-pod claim in this document.
Capacity and availability targets require observed load and failure evidence.

## Implementation map

| Responsibility                                 | Source                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Provider and negotiated access                 | `apps/server/src/infra/realtime/realtime-provider.ts`            |
| Scope admission                                | `apps/server/src/infra/realtime/realtime.controller.ts`          |
| Signing and group publication                  | `apps/server/src/infra/realtime/self-hosted-realtime.service.ts` |
| Gateway lifecycle and revocation               | `apps/server/src/infra/realtime/realtime.gateway.ts`             |
| Authorized replay                              | `apps/server/src/infra/realtime/realtime-replay.service.ts`      |
| Transactional sequence/outbox and retries      | `apps/server/src/ai-generation/outbox.service.ts`                |
| Studio connection lifecycle                    | `apps/studio/lib/canvas-authoring/assets-realtime.ts`            |
| Studio scope sharing, deduplication and replay | `apps/studio/lib/canvas-authoring/assets-realtime-kernel.ts`     |
