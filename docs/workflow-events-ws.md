# Workflow Events WebSocket

Design doc for replacing HTTP polling of `/aurora/workflow/:runId/status` and
`/aurora/drafts/:runId` with a server-push WebSocket channel.

## Why

At 500 concurrent users, ~30% active, each with ~2 open TaskCards:

```
150 users × 2 cards × 2 endpoints / 1.5s = 400 req/s pure polling
```

Of those ~85% return "nothing changed" — workflow steps take seconds-to-minutes,
but we poll every 1.5s. This burns ECS CPU, Nginx connection slots, mobile
battery, and egress bandwidth (~330 GB/day at peak).

At 1000+ concurrent users, polling becomes the dominant load. Push is the right
model: one persistent connection per active workspace, events flow only when
something actually happens.

## Non-goals

- **Chat streaming stays SSE-over-POST.** The current `/assistant/stream-v2`
  uses AI SDK v5's SSE protocol for token-by-token rendering. That already
  streams end-to-end; WS adds nothing. Leave it alone.
- **No Supabase Realtime dependency.** We already have Mastra's event bus
  (`appendEvent` writing to Redis streams). Reuse it, don't introduce a new
  infra layer.
- **No polling fallback.** Client connects via WS or shows a disconnected
  state. Dual code paths are not worth the maintenance cost.

## Architecture

```
Mastra worker                Nest gateway                Web client
─────────────                ────────────                ──────────
workflow step finishes
      │
      ▼
appendEvent(runId, event)
      │
      ├──▶ Redis stream        (existing; durable log)
      │    events:{runId}
      │
      └──▶ Redis PUBLISH       (new)
           channel: events:{runId}
                                      │
                                      ▼
                             SUBSCRIBE channel
                             events:{runId}
                                      │
                                      ▼
                             Forward frame to
                             all sockets bound
                             to this runId
                                                             │
                                                             ▼
                                                  WebSocket onmessage
                                                             │
                                                             ▼
                                                  Redux dispatch
                                                  ToolWorkflowCard
                                                  re-renders
```

**Three-layer responsibility split:**

1. **Mastra** owns event _generation_. It emits events via `appendEvent` (already
   implemented). We only need to add one line: `redis.publish('events:'+runId, ...)`
   in parallel with the Redis stream append.

2. **Nest** owns socket _fan-out_. A WebSocket gateway accepts connections,
   authenticates them, subscribes to the relevant Redis pub/sub channel, and
   forwards frames. Nest is already the auth boundary — stays the auth boundary.

3. **Web** owns presentation. `ToolWorkflowCard` opens a WS per `runId`, handles
   reconnect/heartbeat/visibility, dispatches events into Redux.

Mastra never talks to browsers directly; Nest never inspects workflow
internals. Clean boundaries.

## Wire protocol

All frames are JSON text. UTF-8. No binary framing or compression in v1 (add
later if payloads grow).

### Frame types

```typescript
type WsFrame =
  // Periodic liveness + consistency check. Server sends every 30s.
  | {
      event: "heartbeat";
      data: {
        runHash: string; // sha256(runId + status + currentStep + progress)
        serverTime: number; // ms since epoch, for clock-drift detection
      };
    }
  // A workflow event has occurred. Push directly from Mastra's event bus.
  | {
      event: "workflow_event";
      data: {
        id: string; // unique event ID; client dedupes by this
        runId: string;
        type:
          | "enqueued"
          | "started"
          | "step.started"
          | "step.completed"
          | "step.failed"
          | "progress"
          | "suspended"
          | "resumed"
          | "completed"
          | "failed"
          | "cancelled"
          | "draft.created"
          | "draft.updated"
          | "draft.committed";
        timestamp: number; // ms since epoch
        params?: unknown; // type-specific payload (e.g., { stepId, progress, error })
      };
    }
  // Terminal: server is closing this connection intentionally. Client should
  // NOT auto-reconnect. Used for auth errors, run deleted, etc.
  | {
      event: "terminate";
      data: { reason: string; code: number };
    };
```

### Dedup by ID

Every `workflow_event` carries a unique `id` (ULID, assigned at `appendEvent`
time). Clients maintain a `Set<string>` of seen IDs per connection; dupes on
reconnect are silently dropped. Copies oii's `emitOperation` pattern.

### Heartbeat hash as consistency safeguard

`runHash = sha256(runId + status + currentStep + progress.current + progress.total)`.
Client compares against locally cached state. If mismatch, client triggers a
one-shot `GET /aurora/workflow/:runId/status` to reconcile. Catches the rare
case of dropped `workflow_event` frames without forcing full reload.

**This is the key resilience pattern borrowed from oii.** Without it, a single
dropped frame leaves the UI permanently stale.

## URL design

```
wss://fizzstudio.fizzspace.cn/aurora/workflow-events?runId=XXX&projectId=YYY
```

**One socket per runId.** Rationale:

- Keeps the pub/sub mapping trivial: `runId → Set<Socket>`.
- Socket lifecycle matches card lifecycle — when the card unmounts, the socket
  closes. No phantom subscribers.
- TaskCards are usually 1-2 visible per user at a time. Multiplexing would
  save ~1 connection, not worth the complexity.

Alternative rejected: project-level subscription (`?projectId=YYY`). Would
need server-side filtering (which runs belong to this project), invalidation
when new runs start. Defers complexity for no real benefit at our scale.

## Server: Nest WebSocket gateway

New file: `apps/server/src/assistant/workflow-events.gateway.ts`.

```typescript
@WebSocketGateway({
  path: "/aurora/workflow-events",
  cors: { origin: true, credentials: true },
})
export class WorkflowEventsGateway implements OnGatewayInit, OnGatewayDisconnect {
  private redisSubscriber: Redis; // dedicated connection for SUBSCRIBE
  private socketsByRun = new Map<string, Set<WebSocket>>(); // runId → subscribers
  private runByClient = new Map<WebSocket, string>(); // inverse for cleanup
  private heartbeatInterval: NodeJS.Timeout;

  afterInit(server: Server) {
    this.redisSubscriber = new Redis(process.env.REDIS_URL!);
    this.redisSubscriber.psubscribe("events:*"); // one pattern sub for all runs
    this.redisSubscriber.on("pmessage", (_pattern, channel, message) => {
      const runId = channel.slice("events:".length);
      const sockets = this.socketsByRun.get(runId);
      if (!sockets) return;
      const frame = { event: "workflow_event", data: JSON.parse(message) };
      const serialized = JSON.stringify(frame);
      for (const s of sockets) {
        if (s.readyState === WebSocket.OPEN) s.send(serialized);
      }
    });

    this.heartbeatInterval = setInterval(() => this.sendHeartbeats(), 30_000);
  }

  async handleConnection(client: WebSocket, request: IncomingMessage) {
    // Auth via cookie (same satoken as REST). Extract userId, validate runId ownership.
    const user = await this.authenticate(request);
    const url = new URL(request.url!, "http://x");
    const runId = url.searchParams.get("runId");
    const projectId = url.searchParams.get("projectId");
    if (!user || !runId || !projectId) {
      client.close(1008, "bad_request");
      return;
    }
    if (!(await this.ownsRun(user.userId, runId, projectId))) {
      client.close(1008, "forbidden");
      return;
    }

    this.bindClient(client, runId);
    client.on("close", () => this.unbindClient(client));
  }

  private async sendHeartbeats() {
    for (const [runId, sockets] of this.socketsByRun) {
      const meta = await this.getMeta(runId);
      const runHash = this.computeHash(meta);
      const frame = JSON.stringify({
        event: "heartbeat",
        data: { runHash, serverTime: Date.now() },
      });
      for (const s of sockets) if (s.readyState === WebSocket.OPEN) s.send(frame);
    }
  }
}
```

**Auth**: reuse existing cookie-based session. Handshake rejects with close
code 1008 (policy violation) if unauthorized.

**Pub/sub pattern sub**: `psubscribe('events:*')` means one subscriber
connection handles all runs. Costs one Redis connection per Nest process, not
per runId.

**Heartbeat strategy**: server-initiated every 30s. Client-initiated pings
would waste upload bandwidth; server is authoritative about "still alive".

## Server: Mastra event publishing

Single-line change in `apps/agent/src/mastra/workflows/engine/state.ts`:

```typescript
export async function appendEvent(runId: string, type: WorkflowEventType, data?: unknown) {
  const event = { id: ulid(), runId, type, timestamp: Date.now(), data };

  // Existing: durable log for backfill + status reads
  await redis.xadd(`events:${runId}`, "*", "payload", JSON.stringify(event));

  // New: realtime push to WS subscribers
  await redis.publish(`events:${runId}`, JSON.stringify(event));
}
```

Durability unchanged — the Redis stream is still the source of truth. Pub/sub
is best-effort; subscribers who miss frames catch up via heartbeat hash +
REST status fetch.

## Client: connection lifecycle

Rewrite `apps/web/src/lib/workflow/workflow-events-client.ts` (new file).
Delete the polling logic in `tool-workflow-card.tsx`.

```typescript
class WorkflowEventsClient {
  private ws?: WebSocket;
  private reconnectAttempt = 0;
  private seenEventIds = new Set<string>();
  private destroyed = false;
  private hiddenTimer?: number;
  private lastServerTime = 0;
  private heartbeatWatchdog?: number;

  constructor(
    private runId: string,
    private projectId: string,
    private onEvent: (event: WorkflowEvent) => void,
    private onMismatch: () => void // hash mismatch → parent fetches /status
  ) {
    this.connect();
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("online", this.onOnline);
  }

  private connect() {
    if (this.destroyed) return;
    const url = `/aurora/workflow-events?runId=${this.runId}&projectId=${this.projectId}`;
    this.ws = new WebSocket(url.replace(/^http/, "ws"));
    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.resetHeartbeatWatchdog();
    };
    this.ws.onmessage = (e) => this.handleFrame(JSON.parse(e.data));
    this.ws.onclose = (e) => {
      if (e.code === 1008) {
        this.destroy();
        return;
      } // auth/bad-request: don't retry
      this.scheduleReconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private handleFrame(frame: WsFrame) {
    this.resetHeartbeatWatchdog();
    if (frame.event === "heartbeat") {
      this.lastServerTime = frame.data.serverTime;
      if (frame.data.runHash !== this.localHash()) this.onMismatch();
      return;
    }
    if (frame.event === "workflow_event") {
      if (this.seenEventIds.has(frame.data.id)) return; // dedup
      this.seenEventIds.add(frame.data.id);
      this.onEvent(frame.data);
      return;
    }
    if (frame.event === "terminate") {
      this.destroy();
      return;
    }
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    this.reconnectAttempt += 1;
    const delay =
      Math.min(30_000, 1_000 * 2 ** (this.reconnectAttempt - 1)) + Math.floor(Math.random() * 250);
    setTimeout(() => this.connect(), delay);
  }

  private resetHeartbeatWatchdog() {
    if (this.heartbeatWatchdog) clearTimeout(this.heartbeatWatchdog);
    // Expect heartbeat every 30s. Tolerate 2 misses = 75s.
    this.heartbeatWatchdog = window.setTimeout(() => this.ws?.close(), 75_000);
  }

  private onVisibilityChange = () => {
    if (document.hidden) {
      // Disconnect after 60s hidden to save server resources.
      this.hiddenTimer = window.setTimeout(() => this.ws?.close(), 60_000);
    } else {
      if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
      // Rejoining — force a status fetch to catch up on anything missed.
      this.onMismatch();
      if (this.ws?.readyState !== WebSocket.OPEN) this.connect();
    }
  };

  destroy() {
    this.destroyed = true;
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
    if (this.heartbeatWatchdog) clearTimeout(this.heartbeatWatchdog);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("online", this.onOnline);
    this.ws?.close(1000, "component_unmount");
  }
}
```

Lifecycle rules, explicit:

1. **Mount**: connect immediately, start heartbeat watchdog.
2. **Hidden ≥ 60s**: close socket. Mastra load drops when user tabs away.
3. **Visible → connect**: reopen + trigger `onMismatch` to reconcile any
   dropped events.
4. **Heartbeat missed 2+ times (75s)**: close socket, scheduleReconnect.
5. **Close code 1008**: auth/policy failure, do NOT retry.
6. **Other close**: backoff reconnect, jitter ≤ 250ms.
7. **`online` event**: if socket closed, reconnect immediately (skip backoff).
8. **Unmount**: explicit close with code 1000, clear timers, remove listeners.

## Capacity at 500 concurrent users

Assumptions: 30% active, each with 1-2 TaskCards on screen.

| Metric               | Polling (current)    | WebSocket (target)      |
| -------------------- | -------------------- | ----------------------- |
| req/s (steady-state) | ~400                 | 0                       |
| events/s (actual)    | 0 (polls are wasted) | 10-30 real events/s     |
| Open connections     | ~0 (short HTTP)      | ~150-300 (one per card) |
| ECS CPU (pure poll)  | ~30-40%              | < 5%                    |
| Egress/day           | ~330 GB              | ~1-5 GB                 |
| Update latency (p50) | ~750 ms              | < 50 ms                 |
| Update latency (p99) | ~1.5 s               | < 200 ms                |

Scaling to 2000 users: same architecture, add Nest replicas behind an LB with
Redis pub/sub as the cross-instance bus (already architected this way).

## Risks & mitigations

**LB connection affinity**: Nginx default behavior buffers WebSocket frames,
breaks the upgrade. Fix: add `proxy_http_version 1.1; proxy_set_header
Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
proxy_read_timeout 3600s;` for the `/aurora/workflow-events` location. Deploy
config change precedes code deploy.

**Zombie connections**: Client crashes without sending `close`. Heartbeat
watchdog on server side — if no activity for 90s, close the socket. Pair with
client-side 75s watchdog so client reconnects before server kills.

**Redis pub/sub message loss on subscriber drop**: pub/sub is fire-and-forget.
Mitigations: (1) durable Redis stream still exists as source of truth,
(2) heartbeat hash reconciliation catches drift, (3) reconnect triggers
`onMismatch` to pull missed events via REST.

**Cookie auth over WS**: browser auto-sends cookie on `ws://` handshake. Works.
CSRF doesn't apply (no side effects on GET handshake).

**500 concurrent WS = 500 Node event loop slots**: Node handles 10k+ idle WS
easily. At 500 with 30s heartbeat, steady-state CPU is negligible.

## Rollout

Single cut-over, no dual-stack phase:

1. **Infra**: update Nginx config to support WS upgrade at
   `/aurora/workflow-events`. Deploy Nginx change. Verify handshake works with
   `websocat` from localhost.
2. **Backend**: deploy Mastra `appendEvent` change + Nest gateway together.
   Old polling endpoints (`/status`, `/drafts`) remain — they're still used
   for page reload / mismatch reconciliation, just not for realtime.
3. **Frontend**: ship the new `WorkflowEventsClient` + updated
   `ToolWorkflowCard`. Delete all `setInterval` polling code in the same PR.
4. **Monitor**: Sentry breadcrumbs on reconnect/mismatch events for the first
   week. Watch `workflow_event` Redis pub/sub throughput in Grafana.

No feature flag. No gradual rollout. It works or it doesn't, and the polling
endpoints are still there as a safety net for page reloads (not realtime).

## Open questions

- **Multiple tabs**: two tabs with the same runId → two WS subscriptions,
  duplicate work. Acceptable. If becomes a problem, use BroadcastChannel to
  dedupe within a browser.
- **runHash computation**: SHA-256 feels heavy at 30s intervals × N runs.
  Alternative: version counter incremented by `appendEvent`. Simpler, fewer
  collisions. **Recommend counter over hash.** Revise the schema to
  `{ runVersion: number }` before implementing.
- **Batched events**: if Mastra emits 10 events in 10ms, the client gets 10
  frames. Consider server-side coalescing (hold 100ms, send batch). Defer
  until observed as a problem.

## Estimated effort

- Nginx config + deploy verification: 0.5 day
- Mastra `appendEvent` publish + unit test: 0.5 day
- Nest `WorkflowEventsGateway` + auth + Redis pub/sub plumbing: 1.5 days
- Frontend `WorkflowEventsClient` + `ToolWorkflowCard` rewrite + QA: 1.5 days
- E2E testing across reconnect/visibility/hash-mismatch scenarios: 1 day

Total: **5 engineer-days** for a solo push, or 3-4 days if split
backend/frontend.
