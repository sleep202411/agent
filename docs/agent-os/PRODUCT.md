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
- UI shows **steps, tools, diffs/approvals, duration** — not only chat bubbles.
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
  2. Read script content via tools (bounded sections — never dump 100k words
     blindly into one prompt when a retrieval tool exists)
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

## Golden use case B — Project Canvas (guide Phase 1)

```text
Read nodes / selection → analyze → propose create nodes/edges (patch)
→ approval → apply → undo via versioned project state
```

Both A and B share the same runtime: **tool loop + policy + domain + events**.

## Tool philosophy

| Kind    | Examples                                               | Side effects |
| ------- | ------------------------------------------------------ | ------------ |
| Query   | `script.readSection`, `canvas.read`, `characters.list` | None         |
| Command | `characters.upsert`, `canvas.applyPatch`               | Domain only  |

Commands always carry:

- `idempotencyKey`
- actor + project scope from Gateway (never trusted from model alone)
- base revision / expected version when mutating aggregates

## UX bar (inspired by execution agents)

Minimum Agent Panel surfaces:

- Chat (final + clarifications)
- Plan / steps with timing
- Tool activity (name, status, error)
- Approval card when required
- Artifacts / entity change summary
- Cancel / later: Steer

Do not collapse the entire process into a single assistant bubble.
