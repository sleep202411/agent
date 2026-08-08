# AGENTS.md — Agent OS

**FizzDragon Agent Platform** (codename **Agent OS**).

Greenfield production Agent product. Authority:

- `docs/FizzDragon_AI_Agent_Platform_Production_Guide.md`
- `docs/agent-os/README.md`
- `docs/agent-os/STABILITY.md`

## Product intent

Execution agent (Claude Code–class for creators): user message → multi-step
**tools** → Domain writes → visible steps/approvals. See
`docs/agent-os/PRODUCT.md` golden paths (script→characters, canvas patch).

## Do

- Read `docs/agent-os/*` and the production guide before changing behavior.
- Build for stability first (single run authority, idempotent tools, reconnect).
- Use **LangGraph.js** (`createReactAgent` + tool `interrupt` for approvals).
- Route models through **LiteLLM** only (`@repo/model-router`).
- Phase 1: **no billing, no rate limit** (see PRODUCT.md).
- Put business writes behind Domain Commands (`DomainPort`).
- Keep wire types in `@repo/agent-protocol` (`fizz.agent.v1`).
- Register tools in `@repo/agent-tools` only.

## Do not

- Import from the legacy `apps/agent` application.
- Add Mastra, or treat Ably / LangGraph checkpoint as project truth.
- Run multi-hour generation inside the interactive graph (Temporal owns that later).
- Soft-fail required configuration.

## Commands

```bash
npm run check-types -w agent-os
npm run test -w agent-os
npm run build -w agent-os
```
