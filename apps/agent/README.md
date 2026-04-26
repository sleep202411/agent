# StoryOS Agent

Mastra-based multi-agent server for StoryOS v3. Sits behind the NestJS
proxy at `/aurora/*` and handles every LLM-facing path — supervisor chat,
workflow generation, HITL drafts, persona consultations.

---

## Two-model architecture

StoryOS splits work across **two tiers** on purpose — one model does
routing and nuance, another does bulk generation:

| Tier                    | Env var                                 | Default model   | Used for                                              |
| ----------------------- | --------------------------------------- | --------------- | ----------------------------------------------------- |
| **Router / Supervisor** | `STORYOS_ROUTER_PROVIDER` = per-env     | see table below | Every user chat turn                                  |
| **Persona**             | `STORYOS_PERSONA_PROVIDER` = `deepseek` | `deepseek-chat` | All workflow phases, ask\_\*, analyze_brief, evaluate |

**Router provider per environment**:

| Env             | Provider    | Model               | Rationale                                            |
| --------------- | ----------- | ------------------- | ---------------------------------------------------- |
| local / staging | `anthropic` | `claude-sonnet-4-5` | Best long-prompt instruction following               |
| **prod-com**    | `anthropic` | `claude-sonnet-4-5` | SG / global users → low latency to Claude            |
| **prod-cn**     | `alibaba`   | `qwen-max`          | CN users → stays in-country, no GFW risk, compliance |

Rationale: Claude is strong at long-prompt instruction-following over our
~8k-token supervisor system prompt + 20+ tools, but expensive ($3/$15 per
MTok). DeepSeek is ~10× cheaper ($0.27/$1.10) with acceptable quality for
structured bulk work. Claude's cost surfaces only on the routing layer's
small footprint; bulk token volume stays on DeepSeek.

### When is Claude called? (exactly)

**Only one place**: `apps/agent/src/mastra/agents/storyos.ts` sets
`model: () => defaultRouterModel()`. Every user chat turn hits this.

**Nothing else** uses Claude — not `ask_*` tools, not `analyze_brief`,
not `evaluate`, not any workflow phase. Grep `defaultRouterModel` to
confirm: single import in `storyos.ts`.

### When is DeepSeek called?

Eleven persona agents, all via `defaultPersonaModel()`:

```
roleDesigner        scriptwriter       storyEditor
episodePlanner      storyboarder       evaluator
artDirector         sceneDesigner      propDesigner
briefAnalyzer       scriptSplitter
```

Each persona is invoked from inside a workflow phase (bulk generation)
or from a supervisor tool (`ask_*`, `analyze_brief`, `evaluate`).

### Model hardening (Anthropic or Alibaba routers)

When `defaultRouterModel()` resolves to **either** Anthropic or Alibaba,
the returned model is wrapped with `hardenRouterModel` — four layers of
middleware around the real provider:

```
[outer]  withFallback(DeepSeek)            ← any fallback-worthy error → DeepSeek
[mid]    withCircuitBreaker(5 / 60s)        ← 5 consecutive failures → 60s cooldown
[inner]  withRateLimit(20 / 8s / depth=100) ← bounded concurrency + wait timeout
[core]   withRequestTimeout(30s)            ← stuck upstream releases queue slot
         (primary Anthropic model)
```

Configurable via `STORYOS_CLAUDE_MAX_CONCURRENCY` / `_QUEUE_TIMEOUT_MS` /
`_QUEUE_MAX_DEPTH` / `_CIRCUIT_THRESHOLD` / `_CIRCUIT_COOLDOWN_MS` /
`_REQUEST_TIMEOUT_MS`. Defaults sized for Anthropic Tier 2 (1000 RPM / 80k ITPM)
with prompt caching active.

Observability: `GET /admin/hardening-stats` returns live queue depth,
circuit state, 1-hour fallback counts.

---

## Workflow taxonomy

18 registered workflows in three shapes. All listed in
`WORKFLOW_NAMES` (`lib/redis-keys.ts` + `@repo/shared/workflow`).

### 1. Composed flows (named, cover full user intents)

These chain multiple phases with HITL gates between them. **These two
are the only "named flows"**; everything else is a single phase.

| flow                        | Input                   | Composition                                                                                           | HITL stops          |
| --------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------------- |
| `main_flow`                 | novel / synopsis text   | story_outline → role → role_img → scene → scene_img → prop → prop_img → episode → script → storyboard | 5-6 (prop may skip) |
| `script_to_storyboard_flow` | already-complete script | parse_script → storyboard_phase                                                                       | 2                   |

**Picking between them** is driven by `brief-analyzer`'s `inputType`
classification (`"novel"` / `"synopsis"` / `"script"`). The supervisor
prompt has a routing table in `prompts/storyos.ts`.

### 2. Structural workflows (auto-run, no HITL)

Read raw input → write structured output that downstream phases consume.

| workflow                           | Reads          | Writes                                                         | Charged            |
| ---------------------------------- | -------------- | -------------------------------------------------------------- | ------------------ |
| `story_outline` (script-breakdown) | text / textRef | Redis `outline:{projectId}` (cast, settings, props, structure) | 5 credits/run      |
| `parse_script`                     | text / textRef | Java `episode` rows + `script` content, preserving original    | 1 credit / episode |

### 3. Per-phase workflows (HITL-gated, chainable)

Each produces drafts → HITL suspended → user resolves (approve / revise)
→ applyDecisionStep commits to Java. Phases can be invoked standalone
(with matching prereq state) or as sub-steps of a composed flow.

| phase               | HITL                       | Reads              | Writes            | Charged (per draft) |
| ------------------- | -------------------------- | ------------------ | ----------------- | ------------------- |
| `role_phase`        | ✅                         | outline.cast       | Java worldrole    | 2                   |
| `scene_phase`       | ✅                         | outline.settings   | Java worldscene   | 2                   |
| `prop_phase`        | ✅ (auto-skip if no props) | outline.props      | Java worldprop    | 1                   |
| `role_image_phase`  | ❌                         | Java worldrole     | Java role images  | **0** (Java bills)  |
| `scene_image_phase` | ❌                         | Java worldscene    | Java scene images | **0** (Java bills)  |
| `prop_image_phase`  | ❌                         | Java worldprop     | Java prop images  | **0** (Java bills)  |
| `episode_phase`     | ✅                         | outline            | Java episode      | 2                   |
| `script_phase`      | ✅                         | outline + episodes | Java script       | 8                   |
| `storyboard_phase`  | ✅                         | episodes + scripts | Java shot         | 15                  |

### 4. Ad-hoc design workflows (HITL, no outline needed)

For users without uploaded material — invent from a short paragraph.

| workflow       | Use case                           | Charged (per draft) |
| -------------- | ---------------------------------- | ------------------- |
| `role_design`  | "帮我想 4 个主角" (no source text) | 2                   |
| `scene_design` | "加一个咖啡馆场景"                 | 2                   |
| `prop_design`  | "想要一把有故事的刀"               | 1                   |

### 5. Atomic workflows

| workflow             | Use case                               | Charged          |
| -------------------- | -------------------------------------- | ---------------- |
| `batch_create_asset` | User-provided name/prompt list, no LLM | **0**            |
| `script_edit`        | Rewrite one episode's script           | 10 credits / run |

---

## HITL (Human-In-The-Loop)

A HITL-bearing phase follows a three-step pattern:

```
generateStep        ← LLM produces drafts (persona model, DeepSeek)
     ↓
waitConfirmationStep ← publishWorkflowSuspended → user sees drafts
     ↓                  → user clicks 满意 / 不满意
applyDecisionStep    ← bills + commits (if approved) or discards
```

**Billing lives at the top of `applyDecisionStep`**, before the
approved/rejected branch — LLM cost was incurred at `generateStep`, so
rejecting still costs. If the workflow throws before `applyDecisionStep`
(LLM failed, process crashed, HITL TTL expired), zero charge.

**Button labels on HITL cards** show what the next action is + its cost.
Format is driven by `WorkflowSuspendedOutput.nextAction`:

- Non-terminal phase: `继续 场景生成 (30 积分)` — next phase name + cost
- Terminal phase (storyboard): `完成 · 195 积分` — shows current-phase cost
- Cost = 0 or no payload: falls back to generic `workflowActionAccept` label

---

## Billing (credits)

Enforced by `apps/agent/src/mastra/lib/billing.ts`. Two integration points:

1. **Preflight** in `invoke_workflow` tool: fetches balance from Java's
   existing `/user/query/user/info.scoreBalance`, estimates cost via
   `estimateWorkflowCost`, returns `{error:"INSUFFICIENT_CREDITS"}` if
   short.

2. **Per-phase deduct** in each `applyDecisionStep`: calls
   `deductCredits` once, idempotency key `{runId}:{phase}:generation`.
   Failure-mode: log + continue (no pending/reconciliation layer by
   design).

**Java endpoint contract** (STUBBED — `BILLING_DEDUCT_STUBBED=true`
until backend ships):

```
POST /api/user/credits/deduct
  Body: { userId, amount, reason, idempotencyKey }
  → 200 { success: true, remainingBalance }
  → 402 { error: "INSUFFICIENT", currentBalance }
```

**Price table** (`PRICES` constant) — adjustable, new runs only:

```
parse_script          1 / episode
story_outline         5 / run (fixed)
role_phase            2 / role
scene_phase           2 / scene
prop_phase            1 / prop
episode_phase         2 / episode
script_phase          8 / episode
storyboard_phase     15 / episode
script_edit          10 / run (fixed)
role_design           2 / role
scene_design          2 / scene
prop_design           1 / prop
image_* / batch_create_asset   0
```

Image phases and `generate_project_cover` are **not billed from our
side** — Java handles image-gen deduction directly.

---

## Supervisor tools

Four categories, described in detail in `prompts/storyos.ts`.

| Category                            | Purpose                                           | Examples                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A. Workflow orchestration           | Heavy tasks (batch / HITL / DB commit)            | `invoke_workflow`, `cancel_workflow`, `explain_current_state`                                                                            |
| B. Read + review                    | Ground supervisor replies in actual project state | `query_context`, `list_assets`, `show_drafts`, `evaluate`                                                                                |
| C. Fine-grained direct writes       | Atomic CRUD, no HITL, fast                        | `update_project`, `update_episode`, `delete_episode`, `update_storyboard_row`, `export_scripts`                                          |
| D. Direct-call persona consultation | Discussion-only, no DB write, no HITL             | `ask_scriptwriter`, `ask_character_designer`, `ask_scene_designer`, `ask_art_director`, `ask_storyboard_designer`, `ask_episode_planner` |

Plus UX-gate tools: `require_project_params`, `mark_project_params_updated`,
`generate_project_cover`, `analyze_brief`, `save_project_meta`,
`resume_workflow`.

---

## Development

```bash
npm run dev       # tsx watch, Mastra server on :4111, worker alongside
```

Env vars (minimum for local dev, see `.env` not in git):

```
# Router — choose one provider; only anthropic triggers hardening
STORYOS_ROUTER_PROVIDER=anthropic
STORYOS_ROUTER_MODEL=claude-sonnet-4-5
ANTHROPIC_API_KEY=sk-ant-...

# Persona — DeepSeek for bulk
STORYOS_PERSONA_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...

# Java backend
JAVA_STUDIO_URL=http://...
JAVA_CONTENT_URL=http://...
REDIS_URL=redis://localhost:6379
```

Boot logs print a config banner (see `lib/startup-self-check.ts`)
summarising resolved provider / caching / hardening state — verify the
banner matches your env before testing.

### Useful endpoints

| Endpoint                        | Purpose                                         |
| ------------------------------- | ----------------------------------------------- |
| `GET /admin/healthz`            | Boot probe                                      |
| `GET /admin/hardening-stats`    | Live Claude queue / circuit / fallback counters |
| `POST /chat/storyos`            | AI SDK v5 chat stream (consumed by Nest proxy)  |
| `POST /workflow/start`          | Direct workflow dispatch (button-driven)        |
| `POST /workflow/:runId/confirm` | HITL approve/revise                             |

### Useful scripts

```bash
# DeepSeek concurrency load test (500 concurrent = clean in benchmarks)
DEEPSEEK_API_KEY=... tsx scripts/loadtest-deepseek.ts

# Verify Anthropic prompt caching is actually caching
ANTHROPIC_API_KEY=... tsx scripts/verify-anthropic-cache.ts

# Simulate hardening layers (queue / circuit / fallback) in-process,
# zero network calls, for regression / UX checks
tsx scripts/simulate-hardening.ts
```

---

## Troubleshooting

### `"Let me reorganize my thoughts — please try again in a moment."`

The AgentStreamService fallback bubble. Means the supervisor stream
produced no usable content **or** threw mid-stream. Source:
`apps/server/src/assistant/chat/agent-stream.service.ts:389/431`.

#### Step 1 — figure out which path (server logs)

Container names follow `${COMPOSE_PROJECT_NAME}-server` /
`-agent` (e.g. `production-com-server`, `staging-server`).

```bash
docker logs --tail 300 <env>-server | grep -E 'consume (done|failed)'
```

| Log line                                                                     | Path | Meaning                                                  |
| ---------------------------------------------------------------------------- | ---- | -------------------------------------------------------- |
| `consume done project=… iterations=N finalParts=0 (fallback bubble emitted)` | A    | Stream completed but parts were empty after sanitization |
| `consume failed project=… iterations=N: <message>`                           | B    | Stream threw mid-flight; message is the JS error         |

#### Step 2 — check provider error body (agent logs)

```bash
docker logs --tail 500 <env>-agent | grep -iE 'error|fail|401|403|429|timeout|deepseek|persona|router|insufficient'
```

Look for a `responseBody` near the matched lines — the provider's actual
error JSON tells you what went wrong.

| Error in agent log                                                | Cause                                      | Fix                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| `"Insufficient Balance"` (DeepSeek, code `invalid_request_error`) | DeepSeek account out of balance            | Top up at platform.deepseek.com — **no code/container change**                   |
| `401 Unauthorized` / `invalid api key`                            | Bad / rotated provider key in env file     | Update env, rebuild + redeploy `agent` and `agent-worker`                        |
| `429 Too Many Requests`                                           | Rate limited                               | Wait, or lower `STORYOS_CLAUDE_MAX_CONCURRENCY` / `WORKER_CONCURRENCY`           |
| `timeout` / `ECONNRESET`                                          | Network from container to provider stuck   | Test from inside the container; check provider region status                     |
| `circuit_open`                                                    | Hardening circuit tripped (5 fails in 60s) | Address the underlying provider error first; circuit auto-recovers (default 60s) |

**Heads up — shared keys**: `staging`, `prod-cn`, `prod-com` use the
same DeepSeek API key (see `deploy/.env.*`). A balance/auth issue
takes down **all three environments simultaneously**, so a "prod is
broken" report is usually staging too. Same applies to the Anthropic
router key on global envs.

#### Step 3 — confirm the fix

Once you believe the underlying cause is resolved (top-up, key rotation,
provider recovery), trigger another chat turn from the UI and watch:

```bash
docker logs -f <env>-server | grep 'consume done\|consume failed'
```

A healthy turn logs `consume done … finalParts=N` where `N > 0` and no
`(fallback bubble emitted)` suffix.
