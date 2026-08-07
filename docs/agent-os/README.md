# Agent OS

**Product name:** FizzDragon Agent Platform  
**Codename / monorepo name:** **Agent OS**  
**Path:** `apps/agent-os` + `packages/agent-*`

This is a **new, independent** production Agent product. It does **not** import from,
extend, or dual-stack with:

- `apps/agent` (legacy Mastra StoryOS)
- `apps/agent-platform` (Mastra + Temporal replacement attempt)
- `apps/studio-agent-runtime` (legacy Studio Temporal runtime)

Those remain untouched. Agent OS is the only path for new Agent capability.

## Authority document

`docs/FizzDragon_AI_Agent_Platform_Production_Guide.md`

## Stack (non-negotiable)

| Layer                        | Technology                                               |
| ---------------------------- | -------------------------------------------------------- |
| Control plane                | Agent Gateway (Nest later; local HTTP for Phase 1 dev)   |
| Interactive runtime          | **LangGraph.js** (`createReactAgent` + tool `interrupt`) |
| Long-running work            | **Temporal** (later phases)                              |
| Realtime transport           | **Ably AI Transport** later (events journal first)       |
| Models                       | **LiteLLM** via `@repo/model-router`                     |
| Protocol                     | **`fizz.agent.v1`** (`@repo/agent-protocol`)             |
| Business writes              | Domain Command APIs only — never LLM → SQL               |
| Phase 1 billing / rate limit | **Off** (free; no rate limit)                            |

## Stability invariants

See [STABILITY.md](./STABILITY.md). These are ship gates, not aspirations.

## Layout

```text
apps/agent-os/                 # LangGraph worker + process entry
packages/agent-protocol/       # fizz.agent.v1 wire types
packages/agent-policy/         # risk × mode → approval
packages/agent-tools/          # tool registry + domain client (next)
packages/agent-client/         # product UI client (next)
packages/model-router/         # LiteLLM profiles (next)
docs/agent-os/                 # this charter
```

Gateway lives under `apps/server/src/agent-os-gateway` (feature flag
`AGENT_OS_ENABLED=true`). It authenticates the user, checks story project
permission, then proxies to the Agent OS worker (`AGENT_OS_WORKER_URL`, default
`http://127.0.0.1:4301`). No coupling to Mastra / legacy agent modules.

Local product path:

```bash
# terminal 1 — worker (LangGraph + Qwen)
npm run dev -w agent-os

# terminal 2 — Nest with Agent OS gateway
AGENT_OS_ENABLED=true AGENT_OS_WORKER_URL=http://127.0.0.1:4301 npm run start:dev -w server
# POST /agent-os/runs  (via /aurora rewrite if configured)
```

## Phase 1 scenes

See [PRODUCT.md](./PRODUCT.md) for full intent.

1. **Golden A — Script → characters → DB**  
   Upload script → multi-step tools → approve → characters written to project.
2. **Golden B — Project Canvas** (production guide Phase 1)  
   Read nodes / selection → patch → approval → apply.

Both share the same **tool loop + policy + domain + event journal** spine.
