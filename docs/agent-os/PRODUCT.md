# Agent OS — Product Intent

Authority stack (read in this order when implementing):

1. `docs/FizzDragon_AI_Agent_Platform_Production_Guide.md`
2. `docs/agent-os/ARCHITECTURE.md`
3. `docs/agent-os/STABILITY.md`
4. This file (product intent / golden paths)

## What we are building

An **execution agent** for FizzDragon creators — the creative-domain equivalent of
Claude Code / Codex:

- User sends **one message** (optional attachments).
- Agent **plans, calls tools, observes results, continues**.
- Side effects land in the **project database** via Domain Commands.
- UI shows a compact, live execution state plus durable conversation and
  decision surfaces; raw tool logs do not overwhelm the creator.
- Refresh / stop / approve must be **correct and durable** (see STABILITY.md).

**Not** a chat wrapper that only returns analysis text.

## Phase 1 commercial posture

| Concern                   | Phase 1                                             |
| ------------------------- | --------------------------------------------------- |
| Billing / credits         | **Off** — free for authorized users                 |
| Rate limiting             | **Off** — low traffic; revisit when needed          |
| Auth + project permission | **On** — only actors with project access may mutate |
| Budget guard              | No-op stub (wire later without redesign)            |

Free does **not** mean anonymous write access to any project.

## Explicit non-goals (for the core product)

- Using Mastra / legacy agent apps as the runtime.
- Using LangChain **Deep Agents** package as the product kernel
  (we use **LangGraph.js** + our Gateway/Domain; deep _capability_ is in-graph).
- LLM writing SQL/ORM directly.
- Multi-hour one-click movie inside the interactive tool loop (Temporal later).
- Phase 1 billing, quotas, or rate limits.

## Golden use case A — Script → characters → project DB

Primary user story for validating “this is a real agent”:

```text
User uploads a screenplay (attachment) in a project context.
User: "Analyze characters from this script and write them into my project."

Agent must:
  1. Resolve scene (project, permissions, attachment refs)
  2. Read script content via tools (bounded sections — never dump an entire
     long script blindly into one prompt when a retrieval tool exists)
  3. Analyze / structure character list (model)
  4. Propose writes (preview / Plan + ToolProposed)
  5. Pass Policy (sensitive write → approval when required)
  6. Execute Domain Command(s) to upsert characters (idempotent)
  7. Emit ToolCompleted / ProjectPatchApplied-style events
  8. Summarize what was written (entity ids, counts)

Acceptance:
  - Characters exist in project DB after a successful run
  - Rejected approval → zero writes
  - Replay same idempotency key → no duplicate characters
  - UI can replay steps (sequence journal)
```

### Domain write path (current)

| Layer                                                | Behavior                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Worker tools `characters.*`                          | Prefer Nest HTTP Domain when `AGENT_OS_DOMAIN_URL` + `AGENT_OS_INTERNAL_TOKEN` are set |
| Nest `POST /agent-os/internal/tools/:toolId/execute` | Real `story_bible.put_character` via patch executor + draft CAS                        |
| Offline / unit tests                                 | `InMemoryStoryDomain` (no DB)                                                          |

## Golden use case B — Project Canvas (guide Phase 1)

```text
Read nodes / selection → analyze → propose create nodes/edges (patch)
→ approval → apply → undo via versioned project state
```

Both A and B share the same runtime: **tool loop + policy + domain + events**.

## Start submission contract

- The browser creates stable conversation, submission, turn, and message ids
  before POSTing. Network retry reuses them; a deliberate later send does not.
- User text is accepted up to 20,000 characters and rejected above that limit.
  It is never clipped into a different model request.
- Text may be empty only when at least one attachment is present. The transcript
  then shows attachment chips without fabricating words the user did not type.
- The durable `UserMessage` stores only ordered attachment id/filename
  summaries. File bytes and extracted content remain tool data, not chat data.
- The first durable receipt clears the short-lived browser submission outbox;
  refresh and response-loss retries recover the same run from PostgreSQL.

## Tool philosophy

| Kind    | Examples                                               | Side effects |
| ------- | ------------------------------------------------------ | ------------ |
| Query   | `script.readSection`, `canvas.read`, `characters.list` | None         |
| Command | `characters.upsert`, `canvas.applyPatch`               | Domain only  |

Commands always carry:

- `idempotencyKey`
- stable `toolCallId` (the second unique receipt key)
- actor + project scope from Gateway (never trusted from model alone)
- base revision / expected version when mutating aggregates
- one system-owned execution proof while the command is in flight: initial
  start or post-HITL continuation, never both and never model-authored

The Domain stores a fingerprinted command receipt in the same transaction as
the product write. Retrying an exact command returns the stored result; reusing
either identity for a different payload fails closed. Network ambiguity stays
inside that tool call until the receipt becomes definite, so the Assistant
cannot report failure for a mutation that actually committed.

## UX interaction contract

The panel has four distinct layers; they must not be merged for implementation
convenience:

1. **Transcript** — durable user and Assistant messages in strict order,
   including domain Artifact parts such as a Story proposal.
2. **Activity** — one ephemeral live row whose label changes as planning, tools,
   and external work advance. It is not a transcript message or a checklist.
3. **Decision surface** — Question or Approval controls sit immediately above
   the composer while action is required. Controls never become chat-history
   rows; review content that was shown in the conversation is a durable
   Transcript Artifact instead.
4. **Composer** — remains visible and editable so a creator draft is never
   displaced. Submission and its attachment/model/Skill actions are unavailable
   until the paused run is ready to accept another turn.

When a Decision surface appears above the ordinary composer, it is a labelled
interactive region with a live announcement. Keyboard focus moves to its title
or first actionable control; after submission or dismissal, focus returns to
the ordinary composer. A waiting-for-input / waiting-for-approval activity line
remains visible above the gate without pretending that tools are still running.

An Assistant turn may contain an immediate acknowledgement, activity, and a
later final result while remaining one visual response group. The acknowledgement
does not claim success; the final result is emitted only after the authoritative
tool or background job succeeds. Every card submission is rendered and
persisted as the next user message before Agent OS resumes.

For Story authoring, “Draft ready” means one named production artifact is ready
for review, not applied and not terminal. Its rich card renders a durable
`ArtifactCreated` reference; the approval gate contains only the yes/no
decision. Approval, rejection, reload, and cross-device replay keep the card in
the same Assistant turn while `ArtifactUpdated` changes its lifecycle status.
Discard closes the run without changing the project; Apply acknowledges the
decision, returns to the single live activity row, and completes only after the
Story transaction has committed the proposal.

### Story creation stage contract

The production order is **Script → Plot → Asset Specs → Storyboard Specs**.
Each `story.author` call advances at most one stage. Agent OS reads the canonical
production state, skips stages that are already current, and creates one
independently reviewable proposal for the earliest missing or stale stage.
Approving a stage never grants permission for the next stage. The first
`story.author` call resolves the creator's request once into a durable
`continueThrough` boundary. After every approved artifact commits, the same
Agent run re-reads canonical state; the workflow starts the earliest missing or
stale stage inside that saved boundary, or stops when the boundary is current.
A broad create/complete/adapt request may therefore prepare the next proposal
automatically; a stage-scoped request stops at its named boundary.
Every automatically prepared proposal is still a new Story run with a separate
approval boundary.

The creator-facing narrative source of truth is the **Script**, not a
graph-shaped proposal. When a project has no Script, Agent OS derives a complete
screenplay from the user's prompt and any attached source material. Missing
creative profile fields are collected through the ordinary Question surface;
known fields are not asked again. The resulting screenplay is presented through
the Draft approval surface before any canonical write.

That approval surface renders one persisted, versioned screenplay document.
It does not add review-only metrics, character cards, scene ids, or a second
summary. The blocks shown in “View all” are the exact blocks written to the
chapter Script after approval. Scene/branch/ending structure remains an
internal compiler companion to that document, not a second creator-facing
artifact.

Script Apply is one durable stage transaction:

1. verify that the collaborative Script head still matches the head used for
   authoring;
2. append the approved screenplay to the Script operation log, create an AI
   Script version, and commit the exact Script lineage;
3. terminalize that stage-specific Story run without creating Asset, Plot, or
   Storyboard rows, then resume the owning Agent run at the external-result
   checkpoint so the deterministic stage workflow can compare canonical state
   with the saved `continueThrough` boundary.

On desktop, Plot, Asset Specs, and Storyboard each use the same proposal-ready →
approval → stage-apply lifecycle in a separately audited Story run. Plot Apply
writes only the canonical branching topology compiled from the exact approved
Script. Asset Apply writes only referenceable logical specifications derived
from that Plot and its Script interpretation (possibly an intentionally empty
set) and generates no media. Storyboard Apply writes only sequences, clips,
cues, bindings, and prompts against that approved Plot and Asset set.

The trusted mobile H5 flow deliberately removes the Asset approval checkpoint.
Plot Continue durably authorizes the Server to prepare and persist the derived
Asset Specs, quote and confirm the exact current image set, and admit one image
at a time with per-item billing. A failed item atomically stops every later
unstarted item while retaining completed media. Storyboard remains a separate
Continue/Don't continue boundary. Storyboard Continue saves its specifications
and runs one mixed image/video batch in global story order; the transcript groups
ordered Clips into one horizontally scrollable card per Plot-node sequence.
After every Clip completes, playtest becomes available; publishing is still a
separate creator action. The pages remain directly navigable, and opening one
never silently starts work.

If the Script changed during review, Apply becomes stale instead of overwriting
the creator's edit. A later manual Script edit makes downstream structure stale;
an explicit production request reads the exact current Script head, proposes
only the earliest affected downstream stage, and never adds a Script operation
or changes its text, sequence, or hash. On desktop, paid or slow media generation
remains a later explicit Assets/Storyboard command. On trusted mobile H5, it is
authorized only by the explicit Plot or Storyboard Continue decisions described
above, never by page load or model inference.

Generation produces a media version for a logical Asset Spec or Storyboard
clip; it does not replace that target's semantic specification. A completed
provider job whose output has not attached successfully exposes a separate
attachment retry that reuses the paid output and never submits another model
job. For video, the clip's millisecond timeline duration is the playback
contract. The generation bridge may request the shortest supported source
duration that covers it and trim playback to the timeline; an unsupported
duration must ask the creator to split the clip rather than silently changing
the story timing.

The Plot Tree is the sole branching topology. Every visual Plot node owns
exactly one Storyboard sequence, while a sequence may contain multiple ordered
image or video clips on a continuous millisecond timeline. Asset Specs are
durable logical assets: an empty spec still has a stable identity, name, and
generation prompts and can be referenced from a Storyboard clip. Bindings store
that identity rather than a media URL; follow-selected bindings resolve the
currently selected generated media when it later exists.

When a later upstream-derived plan meets creator-edited Asset or Storyboard
specifications, reconciliation stores the exact pending plan without
overwriting the edit. The creator resolves the conflict explicitly: keep the
current specification and rebase it onto the new source, or apply the exact
latest plan. Compatible generated media, selections, and asset bindings survive
either resolution.
