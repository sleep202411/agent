# Agent OS — Architecture

Canonical product design:  
`docs/FizzDragon_AI_Agent_Platform_Production_Guide.md`

## System diagram

```text
FizzDragon Studio / Web
        ↓
@repo/agent-client  (fizz.agent.v1)
        ↓
Ably AI Transport Adapter
        ↓
Agent OS Gateway  (apps/server — agent-os-gateway)
  · Auth / AuthZ
  · Scene Context
  · Capability + Skill resolve
  · Policy + Budget
  · Run lifecycle (PG authority)
  · Append-only event journal + realtime outbox
        ↓
apps/agent-os  (LangGraph.js worker)
  · ProjectCanvasSubgraph (Phase 1)
  · Postgres checkpointer (agent state only)
  · LiteLLM via @repo/model-router
        ↓
Tool Layer → Domain Commands (idempotent, versioned)
        ↓
PostgreSQL (project truth) · Blob · Redis (non-truth)
```

Temporal enters for long generation / one-click movie (Phase 5+), not for the
Phase 1 interactive canvas turn.

## Run, turn, and message identity

These identities are deliberately different:

| Identity             | Lifetime                                               | Product meaning                                                |
| -------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| `clientSubmissionId` | One semantic start submission across transport retries | Idempotent admission and response-loss replay                  |
| `runId`              | May cross multiple HITL pauses and an external job     | One orchestration lifecycle                                    |
| `turnId`             | Starts at every durable user submission                | One Assistant response group in the UI                         |
| `messageId`          | One immutable durable transcript segment               | User/Assistant ordering, streaming, retry, and replay identity |
| `artifactId`         | One immutable domain result referenced by the journal  | Durable rich content and lifecycle projection                  |

A structured answer submitted through an interaction card is a durable
`UserMessage` and opens a new `turnId`; it resumes the same `runId`. Assistant
acknowledgement, subsequent activity, and final text share that new turn, while
each text segment keeps its own `messageId`. UI projection must never derive a
message identity from `runId`.

## Initial-turn admission

The browser owns stable `conversationId`, `clientSubmissionId`, `turnId`, and
first-user `messageId` values. It retains that identity in a bounded 24-hour
transport outbox until the Gateway returns a durable receipt. A retry of the
same normalized public request reuses all four ids; a later intentional message
gets a new submission.

After project authorization, Gateway checks the submission identity before any
mutable attachment, Skill, or Story-context resolver. The comparison uses a
server-authored fingerprint of public execution semantics: exact text, ordered
attachment ids, model and permission mode, workbench context, and canonical
Skill selections. Resolver timestamps, random resolution ids, filenames, and
live project context are not part of replay identity; their values from the
first successful admission remain frozen in its command.

A single short PostgreSQL transaction reserves the run, stores the frozen start
command, and appends `UserMessage` sequence 1. Attachment-only turns persist an
empty user text plus ordered `{id, filename}` display summaries—never attachment
contents and never an invented English prompt. Text is rejected above 20,000
characters instead of being silently truncated.

Worker HTTP happens only after that commit. Dispatch uses a leased execution
attempt and monotonically fenced epoch; an active attempt may be replayed but
not scheduled by another pod, while an expired attempt can resume from the
submission-bound checkpoint. Old epochs cannot append events or commit domain
effects. A lost HTTP response therefore returns the same durable run and
transcript rather than admitting or executing a second turn.

## Realtime byte-budget and journal resync

Ably is a notification plane, not a second copy of the transcript. The
PostgreSQL event journal remains authoritative for every sequence. Normal
events are published as one independently-idempotent BatchSpec per durable
event and are grouped only while both conservative limits hold: 60 KiB of
actual UTF-8 JSON for one channel/spec envelope and 1.9 MB for one batch
request, with at most 100 specs.

If any event or run snapshot exceeds the single-message budget, the outbox
publishes a small, stable `run.resync` pointer containing the run, conversation,
target sequence, and (for events) durable event id. The original event row is
acknowledged for realtime only after that pointer is accepted. Studio then
pulls the HTTP journal from the earlier of its local contiguous watermark and
the pointer cursor. Normal out-of-order events and snapshots whose
`lastSequence` is ahead trigger the same repair path, so a missed pointer or
N+1 arriving before N cannot permanently skip transcript data. Duplicate
pointers and HTTP retries merge by durable sequence/event identity. An Ably
channel `attached` / `update` notification with `resumed:false` first
reconciles the whole durable conversation—so it can discover a run created and
completed in another tab—then repairs any remaining per-run sequence gap.

## Domain command receipts

Every command tool is admitted through one PostgreSQL receipt keyed by the run
plus both `toolCallId` and `idempotencyKey`. The receipt fingerprints the
complete trusted execution envelope. A matching completed receipt returns its
stored result even after the run is terminal; a divergent reuse conflicts.

An executing receipt has a DB-clock lease. Claim, product mutation, execution
fence, and successful receipt completion share the product transaction. An
expired or superseded owner therefore rolls the whole mutation back, including
when Stop commits first. During an ambiguous HTTP outcome the Worker stays
inside the same LangGraph tool invocation and polls that exact receipt until a
definite result or run abort; it never emits `ToolFailed` merely because the
response may have been lost.

The receipt also binds the execution owner that is allowed to perform the
write. The first graph invocation carries its start execution proof; a graph
resumed after Approval or structured input carries a continuation execution
proof. These envelopes are mutually exclusive and contain the durable token,
attempt, epoch, and owner. Exact completed replay is allowed before the terminal
run fence, but every new claim, expired-lease takeover, and business mutation
locks the run and validates the currently leased proof with the database clock.
An old continuation may therefore read an already-committed exact result, but
cannot commit a new product write after Stop or a newer continuation epoch.
Execution-fenced and receipt-owner-superseded responses are Worker control
flow: they terminate only the stale epoch and must never become a model-visible
`ToolFailed` or `ToolMessage` in the shared checkpoint.

## Human-in-the-loop and external continuation

`request_user_input` is a tool contract, not a frontend convention. It carries
a model-authored `leadIn` and `resumeAcknowledgement`; Agent OS guarantees both
are persisted in the correct order around `UserInputRequired` / `RunPaused` and
`UserInputResolved` / `RunResumed`.

Approval and structured-input resolution first commit the user answer,
resolution, resume, acknowledgement, and a durable continuation command. A
leased continuation dispatcher then resumes the checkpoint with a fenced
attempt and epoch. Consequently, a process crash after the HTTP decision was
accepted but before local graph scheduling does not strand a `running` run or
require the user to submit the answer again. All command tools executed after
that pause carry the continuation proof described above.

Long product work returns a correlated external handoff. The interactive run
becomes `waiting_for_external`; the job stores the originating run, turn,
conversation, and tool call. Its terminal transaction appends the result and
run terminal events to the same journal. A client-generated “success” message
is never a substitute for that durable continuation.

External handoff terminality is monotonic and correlated by
`(turnId, externalJobId)`, not by job id alone (a Story job can serve more than
one phase on separate turns). The Worker drops a replayed handoff after its
correlated `RunResumed`; the Server journal fold independently refuses to
project that stale pause. The continuation dispatcher also re-folds and repairs
historical stale row projections under lock before claiming a new epoch. Any
server-owned deterministic continuation plan is validated and forwarded as one
complete command at the HTTP trust boundary, never reconstructed from a lossy
subset of fields.

An external result is not necessarily terminal. Each Story authoring stage is a
two-phase continuation:

1. `story.author` durably hands off the authoring job and pauses the originating
   run in `waiting_for_external`.
2. A reviewable proposal resumes that run, appends the Assistant result, then
   emits `ArtifactCreated` + `ToolProposed` + `ApprovalRequired` and pauses in
   `waiting_for_approval`. The rich proposal is a durable Artifact part on the
   Assistant turn; the compact yes/no control is the composer-only approval
   projection. The Artifact references the immutable Story run instead of
   duplicating its proposal JSON in the Agent journal.
3. Apply / Discard creates a new durable user `turnId` on the same `runId`.
   Discard records a normal successful completion with no project write. Apply
   atomically moves the Story job to `applying` and the Agent run back to
   `waiting_for_external`. Both decisions append `ArtifactUpdated`; resolving
   the approval never removes or rewrites the original Artifact part.
4. The authoritative apply transaction appends the final Assistant result and
   terminal event to that decision turn. A proposal-ready event must never be
   mistaken for successful project application.

Story production uses four independently reviewable stages: Script, logical
Asset Specs, Plot, and Storyboard Specs. One explicit `story.author` handoff
selects only the earliest missing or stale stage, creates one Story run, and
opens one approval boundary. Approval commits only that stage and terminalizes
that stage-specific Story run; it never silently approves or applies the
following stage. The initial `story.author` call persists the furthest stage
authorized by the creator as `continueThrough`. The owning Agent run then
resumes from its durable checkpoint, re-reads canonical state, and the workflow
deterministically prepares the earliest missing or stale stage inside that
saved boundary. Each proposal still has its own approval boundary; no approval
applies a later stage.

The Script proposal is a versioned chapter screenplay plus one canonical
creator-visible rich-text document and the exact collaborative Script head it
was authored against. Studio reviews that document without re-projecting
screenplay semantics into dashboard cards. Apply writes those exact document
blocks to the chapter's Yjs Script operation and immutable AI document version,
and nothing downstream. Asset Specs pin the exact current Script head. Plot
then pins that same Script interpretation plus the approved Asset snapshot;
Storyboard pins the approved Plot and Asset sources. Their apply transactions
write only the proposed artifact. Plot approval—not Script
approval—binds the chapter's source Script document, version, sequence, and hash
to the reviewed graph, so a pre-existing matching graph cannot bypass the Plot
approval boundary. A changed upstream head fails closed. A manually edited
Script is read from its exact current CRDT head without rewriting its operation,
sequence, or hash. Project Overview remains project-scoped; production stages
and Agent workbench context always carry one explicit chapter id.

Downstream stage plans are immutable chapter-scoped snapshots. An Asset plan
does not contain or precompute Plot or Storyboard work; Plot consumes the exact
approved Asset Spec set, and a Storyboard plan binds both the current Plot and
approved Assets. Reconciliation may attach the corresponding
stage snapshot to a creator-edited Asset Spec or Storyboard sequence as a
pending conflict, but cannot overwrite it. Conflict resolution is an
idempotent, version-checked command that either rebases the current override or
applies the exact snapshot while preserving compatible media and bindings.
Generated media selection is operational provenance, not a semantic edit.

Media generation is a separate target-scoped command. Provider completion,
output persistence, and Story materialization are recoverable stages. A failed
materialization can reattach the same output without creating a new paid job;
an explicit AI retry remains a distinct regeneration command. Video source
duration is selected from provider-supported values and may exceed the
millisecond playback duration, in which case the clip is deterministically
trimmed to its timeline.

The proposal decision and Story lifecycle transition commit in one PostgreSQL
transaction. Gateway must not resume the LangGraph checkpoint for this
control-plane approval: the asynchronous Story workflow, rather than the model,
owns the next state transition.

## Naming

| Audience             | Name                                  |
| -------------------- | ------------------------------------- |
| Product / marketing  | FizzDragon Agent Platform             |
| Engineering codename | **Agent OS**                          |
| npm / folders        | `agent-os`, `@repo/agent-protocol`, … |
| Wire protocol        | `fizz.agent.v1`                       |
| Run channel prefix   | `agent-os:v1:…`                       |

Do not reuse `agent-platform`, `studio-agent`, or `mastra` identifiers in new
code.

## Module ownership

| Module          | Owns                                                  | Must not own                               |
| --------------- | ----------------------------------------------------- | ------------------------------------------ |
| Gateway         | Auth, runs, append-only journal, outbox, budget gates | Model loops, business SQL for story graphs |
| agent-os worker | LangGraph execution, streaming tokens, tool proposals | Project mutations, billing ledger          |
| Domain          | Authoritative writes, revision, idempotency store     | Prompt assembly                            |
| Ably adapter    | Fanout of already-persisted events                    | Lifecycle authority                        |
| LiteLLM         | Provider keys, fallback, RPM                          | Product policy                             |

## Phase roadmap (guide §31)

1. **Foundation** — protocol, gateway, LangGraph, LiteLLM, checkpoint, tools, policy, Ably, **Project Canvas**
2. Interactive Film
3. Skills registry
4. Long script / Story Compiler
5. Temporal long generation
6. One-click movie
7. Codex worker (code only — never general runtime)
