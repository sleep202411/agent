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

1. **Transcript** — durable user and Assistant messages in strict order.
2. **Activity** — one ephemeral live row whose label changes as planning, tools,
   and external work advance. It is not a transcript message or a checklist.
3. **Decision surface** — Question, Approval, or Draft card replaces/overlays the
   composer while action is required. Cards never become chat-history rows.
4. **Composer** — ordinary input only when the run is ready to accept it.

When a Decision surface replaces the ordinary composer, it is a labelled
interactive region with a live announcement. Keyboard focus moves to its title
or first actionable control; after submission or dismissal, focus returns to
the ordinary composer. A waiting-for-input / waiting-for-approval activity line
remains visible above the gate without pretending that tools are still running.

An Assistant turn may contain an immediate acknowledgement, activity, and a
later final result while remaining one visual response group. The acknowledgement
does not claim success; the final result is emitted only after the authoritative
tool or background job succeeds. Every card submission is rendered and
persisted as the next user message before Agent OS resumes.

For Story authoring, “Draft ready” means ready for review, not applied and not
terminal. Its Draft card is the rich rendering of a durable Agent approval.
Discard closes the run without changing the project; Apply acknowledges the
decision, returns to the single live activity row, and completes only after the
Story transaction has committed the proposal.
