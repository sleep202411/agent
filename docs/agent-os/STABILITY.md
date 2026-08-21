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
| Transcript / interaction ordering       | Append-only Gateway event journal                         |

## Hard rules

1. **One cancel path.** User stop → Gateway marks run cancelled → Runtime must
   stop. Transport is notification only; it must not race a second cancel owner.
2. **One run state machine** per `runId` in Gateway DB. A conversation may have
   only one active run because it is also the LangGraph checkpoint thread. UI
   reconciles from PG on reconnect (`lastSequence`).
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
10. **Events are append-only.** A worker snapshot may only contribute a valid
    suffix to the stored prefix. A stale or divergent snapshot cannot truncate
    transcript history or move lifecycle state backwards.
11. **Persist before publish.** PostgreSQL commit precedes Ably. Committed event
    rows form a leased, retryable outbox with stable message ids; realtime
    failure never loses a turn and duplicate delivery never duplicates state.
12. **Every HITL answer is a message.** Interaction UI is ephemeral and lives
    over the composer, but the submitted answer is durably recorded as a user
    turn before execution resumes.
13. **External work is correlated.** A background result must identify its
    source `runId`, `turnId`, conversation, and tool call, then append through
    the Gateway journal. Host-page polling may render progress but cannot invent
    transcript completion.
14. **Proposal-ready is not apply-complete.** A reviewable Story proposal keeps
    the originating Agent run active behind a durable approval. Apply / Discard
    is an idempotent user turn; applying re-enters correlated external work and
    only the Story result transaction may terminalize the run.
15. **Start admission precedes execution.** The first `UserMessage`, stable
    submission / turn / message identities, attachment summaries, and frozen
    start command commit atomically before Worker HTTP. Identical retries replay
    that run even after it is terminal; a divergent payload with the same
    `clientSubmissionId` conflicts.
16. **Execution ownership is leased and fenced.** Dispatch attempt and epoch
    distinguish “scheduled but response lost” from “owner died before
    scheduling.” Checkpoint resume and every journal/domain commit reject stale
    epochs; no transaction or connection is held across Worker HTTP.
17. **Input fidelity is fail-closed.** Start text is at most 20,000 characters
    and is never truncated. Empty text is valid only with attachments;
    attachment contents stay out of the transcript while ordered display
    metadata survives reload.
18. **Decision gates own focus while blocking.** Question, Approval, and Draft
    surfaces are named regions announced on appearance, focus their heading or
    first action, and restore focus to the composer after resolution.
19. **Command outcomes come from durable receipts.** A command mutation and its
    exact response commit in one transaction behind the run/epoch fence.
    Response loss remains an in-flight tool execution, never a model-visible
    failure. Stop or epoch takeover rolls a late product write back, while an
    already-completed exact replay remains readable. A fenced or superseded
    execution is control flow for the stale Worker and cannot emit
    `ToolFailed` / `ToolMessage` into the shared checkpoint.
20. **Human continuation is durably dispatched and fenced.** Approval and
    structured-input acceptance commit a continuation command before Worker
    scheduling. A leased attempt resumes the checkpoint after crash/restart,
    and every post-HITL command transaction validates that continuation's
    token, attempt, epoch, owner, and live lease. Re-sending the same decision
    never consumes the interrupt twice.
21. **Realtime is byte-bounded and gap-aware.** Each Ably message and batch is
    measured as UTF-8 with provider headroom. Oversized durable events and
    snapshots publish stable journal-resync pointers instead of blocking the
    outbox. Studio advances its replay cursor only across contiguous sequence
    numbers and repairs pointer, event, snapshot, and Ably continuity-loss gaps
    over HTTP. Conversation reconciliation precedes per-run repair so a run
    missed entirely in another tab is still discovered.

## Phase 1 acceptance (must automate)

- [ ] Refresh mid-run: client restores correct lifecycle + events from `lastSequence`
- [ ] Stop: no further model tokens billed; no further domain writes
- [ ] Approval reject: zero domain mutation
- [ ] Approval approve: exactly one domain commit; replay same idempotency key is no-op
- [ ] Domain version conflict: structured error; no partial write
- [ ] Model 500 / timeout: run fails cleanly; user sees actionable error
- [ ] Worker process kill mid-turn: resume from checkpoint or terminal fail — never silent orphan "running"
- [ ] Two Gateway/Worker pods race one start: one admission, one execution owner, one first `UserMessage`
- [ ] Start commit succeeds but HTTP response is lost: same `clientSubmissionId` returns the original run (including after terminal)
- [ ] Same `clientSubmissionId` with different text, ordered attachments, model, workbench, or Skill selection returns conflict
- [ ] Execution owner dies before scheduling: lease expiry resumes once; the old epoch cannot append or mutate after takeover
- [ ] Stale full-journal report cannot erase a newer event suffix or terminal state
- [ ] Repeated input submission is idempotent and creates one durable user turn
- [ ] Question card exists only over the composer; reload restores it from `UserInputRequired`
- [ ] External Story proposal appends one durable result to its originating turn after restart/retry
- [ ] Story Draft Apply / Discard appends exactly one durable user turn; proposal-ready never terminalizes the run
- [ ] Story Apply crash/retry produces one project mutation and one final Agent result on the decision turn
- [ ] Attachment-only start reloads as one empty-text user turn with the same ordered filenames and no fabricated prose
- [ ] Blocking card appearance moves accessibility focus into its named region; resolution restores composer focus
- [ ] Two pods execute one command identity: one product mutation and one exact durable result
- [ ] Command commits but HTTP response is lost: the same tool node emits one `ToolCompleted`, never `ToolFailed`
- [ ] Stop wins before a post-HITL command commit: the product transaction rolls back; a prior completed receipt still exact-replays
- [ ] Approval / input commit succeeds but Worker scheduling is lost: a leased dispatcher resumes the checkpoint once with no second user answer
- [ ] A stale post-HITL continuation cannot commit a different command after Stop or epoch takeover; the current epoch succeeds once
- [ ] Ably outage: events remain queryable immediately and outbox publishes them after recovery
- [ ] Oversized emoji/event/snapshot payload: Ably receives a bounded resync pointer; HTTP replay fills the exact missing sequence and later events remain live
- [ ] Realtime N+1 arrives before N or a resync pointer is missed: Studio keeps the earlier contiguous cursor and repairs the full gap without duplicate transcript rows
- [ ] Ably reattaches with `resumed:false`: a waiting HITL card closes from durable history and a run created/finished in another tab appears without reload

## SLO targets (from production guide)

| Metric                                     | Target   |
| ------------------------------------------ | -------- |
| Agent API availability                     | ≥ 99.9%  |
| Reconnect success                          | ≥ 99.95% |
| Duplicate side effects                     | **0**    |
| AI-caused unrecoverable project corruption | **0**    |
| Critical op without approval               | **0**    |
