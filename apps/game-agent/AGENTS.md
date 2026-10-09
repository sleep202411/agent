# Game Agent

Independent game-authoring service powered by the official DeepSeek Harness
runtime and conversation UI. This separation is the user's explicit direction.

- Harness owns the agent loop, tools and conversation. Do not introduce a
  LangGraph/Mastra orchestration loop around it.
- Do not import `apps/agent-os`, `@repo/agent-protocol`, `@repo/agent-tools`,
  Agent OS journals or its configuration. These belong to the other Agent product.
- Read `README.md` and `../../docs/story-studio/game-vibecoding-production-design.md`.
- Model credentials and configuration use only `GAME_AGENT_*`. Studio receives
  no provider credential. Missing required values fail at boot.
- Service-specific tools live in `src/tools`. Virtual user paths never address
  the host filesystem. Compile and validate before submitting a preview result.
- Server owns project authorization and writes. Harness cannot publish or
  mutate project truth directly.
- Official Web GUI admission goes through Server's FD authentication, Story
  project permissions and trusted Studio origin. Keep actor/project scope on
  every control, HTTP and WebSocket request; never return a child launch token,
  loopback port, browser cookie or provider credential to Studio.
- `GAME_AGENT_WORKSPACE_ROOT` is required. Production uses one worker with a
  private persistent ReadWriteOnce volume and a Recreate rollout. Preserve
  metadata, context and official history on departure/restart. Persist the
  launch fence before spawning; record the child immediately; stop its process
  group before releasing the workspace lease. Unknown/live crash leases fail
  closed; never recover by age or delete the workspace to bypass a lock.
- `/aurora/game-agent/*` carries official HTTP and WebSocket traffic to Nest.
  Local Studio uses its existing native `/aurora/:path*` rewrite; production ingress must
  send this traffic directly to Nest with WebSocket upgrades intact.
- Hosted code and fixture validation do not establish deployment, real-account
  authorization, provider availability or post-deployment acceptance. Report
  those checks independently; no production/cloud database writes are implied.
- Game execution belongs to the shared experience engine/player, independently of this service.

Validation: `npm run build -w game-agent`, `npm run check-types -w game-agent`,
`npm run test -w game-agent`, `npm run lint -w game-agent`.
