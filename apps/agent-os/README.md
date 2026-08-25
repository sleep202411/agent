# Agent OS

Codename for **FizzDragon Agent Platform** — production Agent product built from
`docs/FizzDragon_AI_Agent_Platform_Production_Guide.md`.

|          |                                             |
| -------- | ------------------------------------------- |
| Product  | FizzDragon Agent Platform                   |
| Codename | Agent OS                                    |
| Runtime  | LangGraph.js `createReactAgent` + tool HITL |
| Protocol | `fizz.agent.v1` via `@repo/agent-protocol`  |
| Phase 1  | Free · no rate limit                        |

Independent of the legacy `apps/agent` application.

## Local

```bash
# unit + LangGraph golden path (fake model)
npm test -w agent-os

# live Qwen MaaS smoke (uses apps/agent-os/.env — gitignored)
cp .env.example .env   # then fill keys
npm run smoke:qwen -w agent-os

# live HTTP worker
npm run dev -w agent-os
# GET  /health
# POST /v1/agent-os/runs
# POST /v1/agent-os/runs/:runId/approvals
```

Approval and structured-input qualification must use the durable Gateway →
continuation-dispatcher → Worker path. Direct in-process HITL resume scripts
are deliberately not supported because they bypass the production command,
lease, checkpoint, and effect fences.

### Qwen / OpenAI-compatible env

```bash
AGENT_OS_OPENAI_BASE_URL=https://<endpoint>.maas.aliyuncs.com/compatible-mode/v1
AGENT_OS_OPENAI_API_KEY=sk-...
AGENT_OS_DEFAULT_MODEL=qwen-plus
```

Profiles: `qwen-plus`, `qwen-max`, `qwen-turbo`, `creative-balanced` (→ qwen-plus).

See `docs/agent-os/` for architecture, product intent, and stability gates.
