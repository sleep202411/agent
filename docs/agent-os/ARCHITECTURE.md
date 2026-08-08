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
  · Event sequence journal
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
| Gateway         | Auth, runs, approvals, event sequence, budget gates   | Model loops, business SQL for story graphs |
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
