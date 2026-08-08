# Agent OS — Stability Gates

Agent OS exists because prior agent stacks were unreliable (drops, hangs,
inconsistent cancel/resume). **Stability is a product requirement**, not a
follow-up.

## Single sources of truth

| Concern                                 | Authority                                                 |
| --------------------------------------- | --------------------------------------------------------- |
| Project / canvas / story data           | PostgreSQL via Domain Commands                            |
| Run lifecycle (`queued` → … → terminal) | Gateway projection (PostgreSQL)                           |
| Interactive graph / HITL pause          | LangGraph checkpoint (PostgreSQL) — **not** business data |
| Realtime delivery                       | Ably — **accelerates** UI; may drop; never sole truth     |

## Hard rules

1. **One cancel path.** User stop → Gateway marks run cancelled → Runtime must
   stop. Transport is notification only; it must not race a second cancel owner.
2. **One run state machine** per `runId` in Gateway DB. UI reconciles from PG on
   reconnect (`lastSequence`).
3. **Approval is resume of the same run**, not a parallel ambiguous attempt that
   can double-write or double-charge.
4. **All side effects are idempotent** (`idempotencyKey` on every command / paid
   generation).
5. **Optimistic concurrency** on project writes (`expectedProjectVersion` /
   base revision). Conflict → reload → replan; never blind overwrite.
6. **Interactive turns have a hard wall-clock budget.** Timeout → durable
   `failed`/`cancelled` with a public error, not a hung stream.
7. **Models only via LiteLLM.** Timeouts, fallback, and rate limits live at the
   model gateway — not ad-hoc in graph nodes.
8. **Long jobs never run inside the interactive graph.** Temporal owns multi-hour
   production (later phases).
9. **No silent degradation.** Required config missing → fail at boot. Tool /
   domain rejections surface upstream messages to the user.

## Phase 1 acceptance (must automate)

- [ ] Refresh mid-run: client restores correct lifecycle + events from `lastSequence`
- [ ] Stop: no further model tokens billed; no further domain writes
- [ ] Approval reject: zero domain mutation
- [ ] Approval approve: exactly one domain commit; replay same idempotency key is no-op
- [ ] Domain version conflict: structured error; no partial write
- [ ] Model 500 / timeout: run fails cleanly; user sees actionable error
- [ ] Worker process kill mid-turn: resume from checkpoint or terminal fail — never silent orphan "running"

## SLO targets (from production guide)

| Metric                                     | Target   |
| ------------------------------------------ | -------- |
| Agent API availability                     | ≥ 99.9%  |
| Reconnect success                          | ≥ 99.95% |
| Duplicate side effects                     | **0**    |
| AI-caused unrecoverable project corruption | **0**    |
| Critical op without approval               | **0**    |
