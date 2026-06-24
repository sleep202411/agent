# Studio Realtime Architecture — Production / 99.99% / Self-Hosted / .com + .cn

Status: **DRAFT for review** · Owner: platform · Scope: `apps/studio` + `apps/server` realtime plane

> Design bar: enterprise-grade, 4×9 (99.99%) availability, single codebase for Azure AKS (.com) and Alibaba ACK (.cn), zero Azure-managed-service lock-in. No-compromise, target-state.

---

## 0. Context, goals, non-goals

**Where we are (verified by audit, 2026-06-24):**

- prod-com already runs `REALTIME_TRANSPORT=self-hosted` (since 2026-06-14, commit `3936f836`). `RealtimeGateway` (`/ws/realtime`) + Redis pub/sub fan-out + HMAC tokens are live.
- The Yjs collab WS (`/ws/documents`) is the **proven gold-standard**: per-connection auth, **sequence-based catch-up** (`lastAckedSequence` → `afterSequence` replay), exponential-backoff reconnect, 25s ping, IndexedDB offline, Redis cross-pod fanout, DB-persisted ops.
- A **transactional outbox** (`ai-generation/outbox.service.ts`) already guarantees AI-job events survive transport loss (Postgres = source of truth, dispatcher retries).
- **Azure Web PubSub is dormant dead code** that still ships in the client (`transport ?? 'web-pubsub'` fallback + `openWebPubSub`, which re-`negotiate`s on every reconnect with no backoff — the negotiate-flood root cause).

**Goals**

1. One **unified, self-hosted** realtime plane; identical on .com and .cn; no Azure Web PubSub.
2. **Reliable delivery** (at-least-once + idempotent + gap-filled) — strong enough that polling becomes a rare safety net, not a primary path.
3. **99.99%** availability of the realtime SLOs below, across pod/Redis/DB failures.
4. Move the remaining **polling shortcuts** (wallet, entitlement, team roster, project list) to events.
5. Operable: SLO dashboards, alerts, runbooks, multi-pod + chaos tests in CI/staging.

**Non-goals**

- Replacing Yjs CRDT semantics for the canvas document (it stays as-is; it is already the reference).
- Strict exactly-once or total-order across channels (we choose at-least-once + per-channel order + idempotency — cheaper and sufficient; see §3).
- Sub-second financial settlement (the **ledger DB** is the source of truth; realtime only accelerates UI reflection).

---

## 0.5 Current state vs target — the honest gap (read this first)

This document is **target-state**, not a description of today. What exists **now**: the self-hosted transport + `RealtimeGateway` (`/ws/realtime`) + Redis pub/sub fan-out, the Yjs collab WS with sequence catch-up, and the **AI-job** outbox. Everything else below — per-channel `seq` + `eventId` envelope, the `/replay` catch-up endpoint, the generalized outbox for `wallet`/`entitlement`/`team`/`project` events, the client realtime **kernel**, backpressure/resync, token **revocation + refresh**, gateway **rate-limits**, the Redis **HA SKU**, **≥2 replicas + PDB + drain**, the **dedicated dispatcher worker**, and the **SLO/observability/test harness** — is **NOT built yet**. It is the work in §12.

Therefore: **no SLO below is "currently met."** They are the **targets the build is gated on** (§13). Today's system delivers AI-job updates over self-hosted WS with a polling backstop — that is the floor we are raising. The gap between here and the 4×9 target is a **multi-phase build**, not a config flip.

---

## 1. SLIs, SLOs, error budget

We measure the realtime **plane**, not individual sockets.

| #   | SLI                      | Definition                                                                     | SLO (28-day)                |
| --- | ------------------------ | ------------------------------------------------------------------------------ | --------------------------- |
| S1  | **Connect success**      | successful WS upgrade + auth / attempts                                        | ≥ 99.9%                     |
| S2  | **Session uptime**       | time a client holds a healthy connection / time it wants one                   | ≥ 99.95%                    |
| S3  | **Event delivery**       | events delivered to ≥1 live subscriber / events committed to outbox, within 5s | ≥ 99.99%                    |
| S4  | **Delivery latency**     | commit → client receive, p99                                                   | ≤ 1.5s (p50 ≤ 200ms)        |
| S5  | **Catch-up correctness** | reconnects that recover the full gap (no missed/duplicated-after-dedup events) | = 100%                      |
| S6  | **No-flood invariant**   | `negotiate` calls per client per minute                                        | ≤ 2 (hard cap; alert at >6) |

- **Error budget** for the headline SLO (S3, 99.99%) = **4.3 min/month**. Any incident burning >25% of the monthly budget triggers a freeze on realtime changes until a postmortem ships.
- S3 = 99.99% is achievable **because** the outbox makes the DB the source of truth: a missed push is recovered by catch-up; "delivery" only fails if an event is committed and never reaches a client that was online within the window **and** the gap is never filled.
- **Compound-availability honesty.** The _connect path_ is a serial chain: ingress × pod × negotiate(auth). At 99.99% each, the chain is ~99.97% — **below** the headline. So we do **not** claim 99.99% that "a socket is live at any instant" — that is **S2, deliberately set at 99.95%.** The **99.99% is the DELIVERY SLO (S3)**, and it can exceed the connect-path number **only because delivery is decoupled from the live connection** by the outbox + catch-up: an event committed during a connect blip is still delivered on the next reconnect (within the S3 window, else via `/replay`). Redis/pod/ingress failover time is charged to **S4 latency**, not S3. If you ever wire a domain (e.g. wallet) _without_ the outbox+catch-up, its delivery SLO collapses to the connect-path ~99.97% — which is **why every realtime-bearing mutation must go through the outbox (§3), non-negotiable.**

---

## 2. Architecture overview

Two WebSocket endpoints, one connection each, multiplexed by **channel**.

```
                ┌────────────────────────── apps/server (N pods) ──────────────────────────┐
  client        │  HTTP: POST /aurora/realtime/negotiate  → HMAC token {channels[], exp}    │
  ───────────►  │                                                                            │
  negotiate     │  WS /ws/documents  (Yjs CRDT: ops + awareness + seq catch-up)  [unchanged] │
  (authed)      │  WS /ws/realtime   (EVENT PLANE: subscribe channels, recv events, ack seq) │
                │        ▲ verify HMAC, authorize channel grants, register socket locally    │
                │        │                                                                    │
   mutation ───►│  Service tx ──► OUTBOX (Postgres, same tx) ──► Dispatcher ──► Redis pub/sub │
   (any pod)    │                  (source of truth, per-channel seq)   (fan-out to all pods) │
                └────────────────────────────────────────────────────────────────────────────┘
                                              ▲ Redis (HA) ▲
```

**Components**

- **Event plane WS** (`/ws/realtime`, generalized): every server→client event — `ai_job_update`, `media_asset_*`, **`wallet_changed`, `entitlement_changed`, `team_member_changed`, `project_changed`**, `notification` — flows here as a **channel** subscription. `/ws/notifications` is folded in and retired.
- **Documents WS** (`/ws/documents`): unchanged. (It already embodies most of this design; the event plane is modeled on it.)
- **Outbox + dispatcher**: generalized from AI jobs to all realtime-bearing mutations. The **only** sanctioned way to emit an event.
- **Redis pub/sub**: cross-pod fan-out (HA — see §5).
- **Client realtime kernel** (`apps/studio/lib/realtime/`): one socket manager — negotiate-once, subscribe/unsubscribe, backoff+jitter+circuit-breaker reconnect, ping, token refresh, per-channel seq + dedup, resync-on-gap. Replaces `assets-realtime.ts`'s dual transport. **Web PubSub removed.**

---

## 3. Delivery semantics (the contract)

This is the heart of 4×9. We commit to **at-least-once, per-channel ordered, idempotent, gap-filled**.

**Event envelope**

```jsonc
{
  "channel": "wallet:user:15", // <topic>:<scope>:<id>
  "seq": 90432, // monotonic per CHANNEL (from outbox)
  "eventId": "01J...ULID", // globally unique (idempotency key)
  "type": "wallet_changed",
  "ts": 1750000000000,
  "data": {
    /* type-specific */
  },
}
```

**Producer side (outbox pattern, generalized)**

- Every mutation that has realtime consumers writes an `ai_event_outbox`-style row **inside the same DB transaction** as the state change. No event without a committed state change; no committed state change without an event. (Eliminates the dual-write race.)
- `seq` is allocated per channel via a monotonic counter (sequence/`SELECT ... FOR UPDATE` on a per-channel cursor, or a Postgres sequence per channel-class). Ordering is guaranteed **within a channel** only.
- A **dispatcher** (existing) claims undispatched rows (batched, locked w/ TTL so a crashed pod's rows re-dispatch), `PUBLISH`es to `realtime:chan:<channel>`, marks `dispatched_at`. Retries on failure. This is what makes S3 reachable.

**Transport side**

- Redis pub/sub is **best-effort** (no ordering/durability if a subscriber is offline). That is acceptable **because** the outbox + catch-up is the durability layer; Redis is just the fast path.

**Consumer side (client kernel)**

- Tracks `lastSeq` **per channel**.
- On a live event: if `seq == lastSeq+1` → apply; if `seq <= lastSeq` → **dedup/drop**; if `seq > lastSeq+1` → **gap detected** → request catch-up.
- **Catch-up**: `GET /aurora/realtime/replay?channel=...&afterSeq=lastSeq` (served from the event store / outbox tail, retained ≥ 24h) returns the missed events in order; client applies, advances `lastSeq`.
- On reconnect: for every subscribed channel, send `lastSeq`; server replays the gap before resuming live. (Mirrors `/ws/documents` `afterSequence`.)
- **Idempotency**: consumers key on `eventId`; applying the same event twice is a no-op. UI state derives from server truth (e.g., wallet shows the event's `balance`, never `+=`).
- **Offline longer than the replay window**: if a client's `lastSeq` is older than the retained tail (window = **2× the longest realistic offline**, measured — laptop sleep, closed tab, mobile background; §14.2, not "24h" by guess), gap-replay cannot reconstruct it. The client then does a **snapshot re-fetch** of the channel's current state (the ordinary REST read) and resets `lastSeq` to the snapshot's seq — correct, just not incremental. The kernel always has this fallback, so an unbounded offline never corrupts state.
- **Cross-channel causality**: order is guaranteed **within** a channel only. Causally-linked facts (a spend that moves _both_ `wallet` and `entitlement`) are either (a) **co-located on one channel** when they must be applied atomically, or (b) modeled so each consumer is **state-derived + idempotent** (renders the server's truth, not a delta) — making cross-channel arrival order irrelevant. We do not promise global order; we make consumers not need it.

> Result: realtime is now **lossless from the client's perspective**. Polling is no longer needed to "catch missed pushes" — only as a disconnected-state fallback (§11).

---

## 3.5 The job / model-queue channel — primary realtime contract

The AI generation **queue** (concurrency, fairness, provider capacity, deferral) is a **separate subsystem** (`apps/server/src/ai-generation`). This design does **not** redesign its scheduling. The boundary is the **event contract** below: **scheduling is the queue's, delivery is ours.**

The queue emits, **through the outbox (§3)**, a job lifecycle on channel `job:<jobId>` (plus a roll-up `jobs:workspace:<id>` for the feed):

| state                 | when                       | payload essentials                                                                    |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `queued`              | accepted, awaiting a slot  | **`queuePosition`, `reason`** (`awaiting_concurrency` / `awaiting_provider_capacity`) |
| `running`             | dispatched to provider     | `etaSeconds`, `provider`, `modelId`                                                   |
| `progress`            | provider progress (if any) | `pct` / step                                                                          |
| `succeeded`           | outputs ready              | `outputs[]`, `costPoints`                                                             |
| `failed` / `canceled` | terminal                   | `errorCode`, `refunded`                                                               |

Rules:

- Every transition is **one outbox event** with a per-channel `seq` → reliable, ordered, gap-fillable. The client renders the **state machine**, never a bare spinner.
- **`queued.queuePosition` + `reason` is mandatory.** It is exactly what was missing when a job sat `deferred concurrency (1/1)` for ~80s and the client fell back to a blind polling/reconnect storm. Surfacing it kills both the bad UX **and** the polling reason.
- The queue publishes a position update when the queue ahead shrinks (**debounced**), not a per-second tick.
- This is what makes the §11 demotion of job-status polling real: with the lifecycle on the wire, the only "poll" is the one-shot catch-up on (re)subscribe.

**Coordination boundary**: the queue owns _when_ a transition fires and _what_ `reason`/`queuePosition` is; realtime owns the envelope, the channel, and delivery. This table is a **cross-team contract** — changes require both owners.

---

## 4. Connection lifecycle (client kernel)

One socket per endpoint, owned by a single kernel; React hooks subscribe to channels, never own sockets.

1. **Negotiate once** per connection lifecycle: `POST /aurora/realtime/negotiate` → `{ url:/aurora/ws/realtime, token, exp, channels[] }`. **Token is reused across reconnects** (root fix for the flood). Re-negotiate only when (a) token within `exp-5min`, or (b) the server rejects the token.

- **Token refresh**: proactive at `exp-5min` via a lightweight `POST /negotiate/refresh`; never let the server force-close on expiry mid-stream.

2. **Reconnect**: `delay = min(cap, base * 2^attempt)` with **full jitter** `random(0, delay)`. `base=1s`, `cap=30s`. (Jitter prevents the thundering-herd reconnect storm — audit gap #4.)
3. **Circuit breaker**: after `K=6` consecutive failures, enter **cooldown** (`60s`), then a single probe; success resets. During cooldown, the polling fallback (§11) carries updates. (Caps `negotiate`/connect attempts → enforces S6.)
4. **Keepalive**: client pings every 25s; the **server beats faster than the client's liveness deadline** (server **20s** vs the client's 2-missed-pong ≈ 50s) so a timing race never trips a false dead-connection. Missed-pong (×2) → treat as dead → reconnect. (Detects half-open TCP that ingress timeouts miss.)
5. **Graceful close**: on logout/unmount, close cleanly (no reconnect).
6. **Negotiate on the same backoff**: the HTTP `negotiate` / `refresh` calls use the **same backoff + jitter + circuit-breaker** as the WS connect — an auth/negotiate-endpoint outage cannot thundering-herd the endpoint either (negotiate is otherwise an unprotected serial dependency).

**Removed**: `openWebPubSub`, the `@azure/web-pubsub-client` dependency, and the `?? 'web-pubsub'` fallback. The negotiate response no longer carries `transport`; absence of a self-hosted URL **fails loud** (required-env-fails-loud — Engineering standards).

---

## 5. Multi-pod fan-out + Redis HA (no SPOF)

- Each pod keeps a **local registry** `Map<channel, Set<socket>>`. A pod `PUBLISH`es an event to `realtime:chan:<channel>`. **Pods subscribe only to the channels they currently hold subscribers for** — `SUBSCRIBE`/`UNSUBSCRIBE` per channel as the first/last local subscriber joins/leaves.
  - **Do NOT use a wildcard `PSUBSCRIBE realtime:chan:*`** (today's code does): that is **O(events × pods)** — every pod receives every event for every channel and filters locally, which melts under high mutation rate at 10× load. The explicit per-channel model is **O(events × interested-pods)**.
  - For very high channel cardinality (e.g. one channel per canvas node), bound the subscription count with **hashed shards** `realtime:shard:<hash(channel) % K>` (K sized to keep per-pod subscriptions in the thousands); the gateway still filters to the exact channel locally. (`/ws/documents` already shards by document id — same pattern.)
- **Redis is the only shared dependency → must be HA**:
  - .com: Azure Cache for Redis **Standard/Premium (replicated, zone-redundant)** — not Basic C0 (today's SPOF). Premium for clustering if connection volume warrants.
  - .cn: Aliyun Redis **master-replica (HA) instance**, not a single node.
- **Graceful degradation if Redis is unreachable**:
  - Pods keep serving **local** subscribers (intra-pod fan-out still works).
  - Cross-pod events are missed _during_ the outage — but **not lost**: the dispatcher keeps them in the outbox (un-`dispatched`), retries when Redis returns; clients also recover via **catch-up** on their next heartbeat-gap/reconnect. Net: a latency spike, bounded recovery, **no permanent loss** → S3 holds.
  - A dedicated **dispatcher liveness** + **Redis-up** alert fires; HPA does not scale on a Redis outage (would worsen it).
- **No sticky sessions** required (kernel is stateless w.r.t. pod; any pod can serve any channel). Round-robin ingress is fine.

---

## 6. Backpressure & flow control

- Each socket has a bounded **send buffer** (e.g., 256 events / 1MB). On overflow (slow consumer): **drop buffered events**, set a `resync_required` flag, and send a single `{type:"resync", channels:[...]}` control frame. The client then does a catch-up (`afterSeq`) — cheap, correct, and prevents one slow client from holding memory.
- Server **publish rate** per channel is naturally bounded by mutation rate; a hot channel (e.g., a 500-node canvas job burst) is coalesced at the producer where safe.
- Inbound (client→server) frames are limited to ping/subscribe/ack; **max frame size** enforced; unknown frames dropped.

---

## 7. Security

- **Auth**: `negotiate` is an authed HTTP call (satoken). It mints an **HMAC-SHA256 token** carrying `{ userId, channels[] (grants), exp }`. The WS verifies the HMAC **statelessly** — no per-connection DB lookup. (Fixes audit gap #7: the documents gateway's per-connect `validateToken` DB hit moves behind the same stateless token, or a Redis-backed session cache.)
- **Per-subscribe authorization**: a client may only subscribe to channels in its token grants; subscribing outside grants → reject + audit log. Grants are scoped (`wallet:user:<self>`, `team:workspace:<member-of>`, …). A `subscribe` frame **re-checks the live permission** (cheap, Redis-cached) for that channel — it does **not** trust only the token's baked-in grant list, so a stale grant cannot be replayed.
- **Revocation — server-pushed, never "wait for expiry" (the critical gap).** Stateless tokens otherwise grant their channels until `exp`; a removed member would keep access for the full TTL. So: (a) keep the token **TTL short (≤ 5 min)** with proactive refresh (§4), **and** (b) on any authz-changing mutation (member removed, role downgraded, workspace/project deleted) publish a **revoke signal** `realtime:revoke:<channel>` / `realtime:revoke:user:<id>`; every pod consumes it and **immediately unsubscribes/closes** the affected sockets mid-stream (this mirrors the proven `documents.gateway.ts` revoke flow). The denied client's next reconnect re-negotiates and simply isn't granted the lost channel.
- **HMAC secret rotation**: tokens carry a **key id (`kid`)**. Rotating `REALTIME_WS_SECRET` keeps the previous secret in a **secondary slot for a grace window ≥ token TTL**; gateways accept both during the window, so rotation never invalidates in-flight tokens. Without `kid`, a rotation would mass-disconnect everyone — unacceptable.
- **Secrets**: `REALTIME_WS_SECRET` from Key Vault / Aliyun KMS, **required-fails-loud** at boot (already enforced).
- **Abuse controls**: per-IP and per-user **connection rate limit** + **max concurrent connections** at the gateway (survive reconnect storms / DoS — audit gap #4). Negotiate endpoint rate-limited per user.
- **Transport**: `wss://` only; tokens in the WS subprotocol/`Sec-WebSocket-Protocol` or first frame (avoid `?token=` in URLs/logs where feasible; if query param is kept for ingress simplicity, scrub access logs).

---

## 8. Capacity & scaling

- **Budget per pod**: target ≤ 8–10k concurrent WS / pod (Node single-process; validated by load test before committing the number). Each idle WS ≈ small heap + a registry entry.
- **HPA** on: connection count (custom metric) + CPU; min 2 replicas in prod (eliminates the single-replica risk — today server defaults to 1). PodDisruptionBudget ≥ 1 to keep a pod during rollouts.
- **Redis sizing**: pub/sub throughput = events/s × fan-out pods; well within Standard/Premium for expected load; monitor `instantaneous_ops_per_sec` + connected_clients headroom.
- **Connection draining on rollout**: on `SIGTERM`, stop accepting, send `{type:"reconnect", reason:"draining"}` so clients reconnect to a healthy pod _before_ the socket dies. Requires `terminationGracePeriodSeconds: 45` + a `preStop` sleep on the Helm deployment to give the drain time (today neither is set — a rolling update hard-kills sockets).
- **Dedicated dispatcher worker**: the outbox dispatcher runs as its **own deployment**, not inside the API pods (today it shares the API process) — so an API request storm cannot starve event dispatch (protects S4). It scales independently, has its own liveness alert, and a grace period to finish an in-flight batch.

---

## 9. Failure-mode matrix

| Failure                           | Behavior                                         | Recovery                                                     | SLO impact                                 |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------ |
| One pod crashes                   | its sockets drop                                 | clients reconnect (jitter) to other pods; catch-up fills gap | S2 dip (seconds), S3 intact                |
| Redis unreachable                 | cross-pod events paused; local fan-out continues | dispatcher retries; clients catch-up on reconnect            | S4 latency spike; S3 intact (no loss)      |
| Postgres (ledger) down            | mutations fail at source; **no** event emitted   | nothing to deliver; correctness preserved                    | upstream outage, realtime correct          |
| Dispatcher stalled                | events queue in outbox                           | liveness alert; backlog drains on recovery; clients catch-up | S4 spike; S3 intact if drained < retention |
| Token expires mid-stream          | proactive refresh at exp-5m                      | refresh; if missed, reconnect + re-negotiate                 | no user-visible blip                       |
| Ingress drops WS upgrade          | connect fails                                    | circuit-breaker → polling fallback; alert                    | S1/S2 dip; data still flows via fallback   |
| Reconnect storm (mass disconnect) | many reconnects                                  | full-jitter backoff + per-IP/user rate limit absorb          | bounded; S6 enforced                       |
| Network partition (client)        | dead connection                                  | missed-pong detect → reconnect → catch-up                    | bounded                                    |
| Bad deploy                        | —                                                | canary + feature flag → instant rollback (§12)               | contained to canary                        |

Every row has **bounded recovery** and **no permanent data loss** — the property that lets S3 hold at 99.99%.

---

## 10. Observability (SLO-driven)

- **Metrics** (Prometheus): `rt_connections{pod}`, `rt_connect_attempts/success`, `rt_reconnects`, `rt_negotiate_total{user}` (S6), `rt_event_publish_total`, `rt_event_deliver_latency_seconds` (S4 histogram, commit→client via an in-envelope `ts`), `rt_outbox_backlog`, `rt_dispatch_fail_total`, `rt_resync_total`, `redis_up`.
- **Dashboards**: one per SLO; error-budget burn-down.
- **Alerts**: S6 flood (>6 negotiate/client/min), reconnect-rate spike, outbox backlog > threshold, Redis down, dispatcher liveness, delivery-latency p99 > 1.5s.
- **Tracing**: mutation → outbox → dispatch → publish spans (sampled), to attribute S4 latency to a stage.
- **Runbooks**: "negotiate flood", "Redis down", "outbox backlog", "reconnect storm" — each with the dashboard, the likely cause, and the mitigation.

---

## 11. Polling governance

Realtime is now reliable (§3), so polling is demoted to a **disconnected-only safety net** + a few legitimately-static reads.

| Today                                                               | Verdict              | Target                                                                                          |
| ------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| wallet balance (60s poll)                                           | shortcut (financial) | event `wallet_changed`; **no interval poll**                                                    |
| entitlement/plan (30s)                                              | shortcut             | event `entitlement_changed`                                                                     |
| team roster (staleTime only)                                        | shortcut             | event `team_member_changed`                                                                     |
| project list (staleTime)                                            | shortcut             | event `project_changed`                                                                         |
| job status (5s/20s hybrid)                                          | over-eager           | keep **5s only while disconnected**; drop the 20s "reconcile-on-connect" (catch-up replaces it) |
| ETA tickers (1s), model catalog (5m), profile (5m), analytics (20s) | fine                 | unchanged (local animation / genuinely static)                                                  |

Rule: **polling intervals only run while the realtime kernel reports `disconnected`**; when connected, the only "poll" is the one-shot catch-up on (re)subscribe.

---

## 12. Migration plan (phased, flag-gated, reversible)

Each phase is an independent, reversible PR behind a flag; canary on .com first, then .cn.

- **P1 — Stop the bleeding** (low risk, immediate): remove the client Web PubSub path + `?? 'web-pubsub'` fallback; default to self-hosted; add jitter + circuit-breaker to the existing self-hosted reconnect. Kills the flood. _(No server change.)_
- **P2 — Client realtime kernel**: extract one socket manager (negotiate-once, token-reuse/refresh, per-channel seq+dedup, resync, subscribe API). Migrate `assets-realtime` + `notifications-socket` consumers onto it. Retire `/ws/notifications` after.
- **P3 — Generalize the outbox + channels**: emit `wallet/entitlement/team/project` events from their mutation transactions; add `/aurora/realtime/replay` (catch-up). Wire the 4 polling shortcuts to channels.
- **P4 — Reliability hardening**: Redis HA (Standard/Premium + Aliyun HA), ingress explicit WS-upgrade annotations + tuned timeouts, gateway connection/rate limits, draining-on-SIGTERM, min 2 replicas + PDB.
- **P5 — Decommission Web PubSub** (server): remove `WebPubSubService`, the Azure connection-string projection, and the dependency. `REALTIME_TRANSPORT` becomes the only (self-hosted) path.
- **P6 — Verification**: SLO dashboards live; multi-pod e2e + chaos + load + soak in staging (next section) gating the rollout.

**Rollback**: each phase flag-off restores the prior path; P1–P2 keep the old client code until P5.

---

## 13. Testing strategy (gates the rollout)

- **Unit**: seq/dedup/gap logic, backoff+jitter math, circuit-breaker, token verify.
- **Integration**: outbox → dispatcher → Redis → gateway → socket (single pod).
- **Multi-pod e2e** (staging, ≥2 replicas): event on pod A reaches a subscriber on pod B; reconnect-to-different-pod catch-up.
- **Chaos**: kill Redis mid-stream; kill a pod mid-publish; expire tokens; drop the network — assert bounded recovery + zero loss (S3/S5).
- **Load**: 10k+ concurrent connections, publisher fan-out at target rate; measure S4 p99, pod memory, Redis ops headroom.
- **Soak**: 24–72h at load; assert no leak (sockets, registry, Redis subs), stable S2.
- **CI**: the multi-pod e2e + chaos suite runs in the staging cluster on the realtime path; a red suite blocks the rollout flag.

---

## 14. Open questions / risks

1. **Per-channel seq allocation** under high write concurrency — Postgres sequence vs cursor table; benchmark before committing.
2. **Catch-up store retention** (24h) vs cost; what window guarantees S5 for the longest realistic client offline.
3. **Wallet event source of truth** — must emit from the ledger write path (not a poller); confirm all top-up/refund/spend paths go through one service.
4. **Documents gateway auth** — fold into the stateless-token model or add a Redis session cache; decide to fully unify auth.
5. **10k/pod** is a placeholder — the load test sets the real HPA target.

---

## 15. Adversarial review log

This design was red-teamed by four independent principal-level lenses (delivery-semantics, SRE/reliability, security, scale/ops), each verifying claims against the code. Disposition:

- **"Promised but not yet built"** (per-channel seq, `/replay`, the four new event types, the client kernel, backpressure, Redis HA SKU, ≥2 replicas/PDB/drain, rate-limits, dispatcher worker, observability, tests): **confirmed as the build (§12), not design flaws.** The reviewers independently reproduced this exact gap list — corroboration that the design scoped the right work. §0.5 makes the target-state framing explicit so no SLO is mistaken for "met today."
- **Genuine design gaps, now incorporated**: token **revocation** + `kid` secret rotation + subscribe-time re-authz (§7); the **`PSUBSCRIBE *` → per-channel/sharded** fan-out fix (§5); **compound-availability** honesty separating S2 (connect path) from S3 (delivery) (§1); **snapshot fallback** for offline-beyond-retention + **cross-channel causality** rules (§3); **dedicated dispatcher worker** + drain/grace (§8); **negotiate-on-same-backoff** + heartbeat alignment (§4).
- **Single biggest hole flagged**: without `/replay` + per-channel seq, offline clients have no durability path, so S3 (99.99%) is impossible. That is exactly **P3** — the gating phase. The SLO is **not claimed** until P3 + P6 ship and 4 weeks of <5% budget-burn pass (§1, §13).

---

_This document is the binding design. Implementation proceeds phase-by-phase (§12); each phase ships with its tests (§13) and updates the relevant SLO dashboards (§10). It has been adversarially reviewed (§15); changes to the delivery contract (§3), security model (§7), or SLOs (§1) require re-review._
