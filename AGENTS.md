# AGENTS.md — FizzDragon Platform

## Final parity integration and exclusive Mobile handoff (2026-10-06)

The user explicitly authorized one final parity completion: merge latest
`main` / `develop` into `feat/mobile-2.4.0-scrolling-screen`, finish and validate
that work, then align all three remote branches to the same verified commit.
This is a one-time exception to the earlier completed handoff below.

After this final integration, only Hu Xuan (`sleepy202411`), the assigned Mobile
developer, may handle Mobile development. Ric and this agent must stop Mobile
implementation, parity follow-ups and Mobile feature-branch development/pushes.
Do not treat this final authorization as permission for further Mobile work.
Shared Web/backend work must preserve the handed-off Mobile API contracts.
Deployment and real-device acceptance remain with their assigned owners.

Repo-level orientation for AI coding agents and humans new to the
monorepo. Scope is **navigation + cross-cutting conventions only** —
each `apps/*` and `packages/*` ships its own deep guide.

## Architecture

Three-app monorepo behind one product (FizzDragon — AI animation /
storyboard / IP co-creation platform). The user-facing brand is
**FizzDragon** in every language, including zh-CN / zh-HK. Do not translate
or transliterate the brand name.

```
┌──────────────────────────────────────────────────────────┐
│                       Web (Next.js 16)                    │
│  Renders all user-facing pages + the in-product studio.   │
│  Talks HTTP to:                                           │
│    /aurora/*       → NestJS server                         │
│    /api/* /studio/*→ Java Studio (external)               │
│    /user/* /project/* /vedio/* → Java Content (external)  │
└─────────┬───────────────────┬────────────────────────────┘
          │                   │
          ▼                   ▼
┌────────────────────┐  ┌────────────────────────────────┐
│ Server (NestJS)    │  │ Java Studio / Content services │
│ Session / chat WS  │  │ (out of monorepo)              │
│ Agent OS Gateway   │  │ Image / video gen, billing,    │
│ /aurora/* routes   │  │ user / project / video CRUD    │
└────────┬───────────┘  └────────────────────────────────┘
         │
         ▼
┌────────────────────┐
│ Agent OS (NEW)     │
│ LangGraph.js       │
│ Temporal (long)    │
│ Ably + LiteLLM     │
│ fizz.agent.v1      │
└────────────────────┘
```

| Path                         | Stack                                          | Purpose                                                 |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `apps/web`                   | Next.js 16 App Router, React 19.2, Tailwind v4 | User-facing site + studio UI                            |
| `apps/server`                | NestJS                                         | Session, chat WS, Agent OS Gateway, billing glue        |
| `apps/agent-os`              | LangGraph.js + LiteLLM                         | **FizzDragon Agent Platform** (codename Agent OS) — NEW |
| `apps/agent`                 | Mastra + AI SDK                                | Legacy StoryOS — do not extend                          |
| `packages/agent-protocol`    | TypeScript + Zod                               | Agent OS wire protocol (`fizz.agent.v1`)                |
| `packages/agent-policy`      | TypeScript                                     | Agent OS approval / risk policy                         |
| `packages/shared`            | TypeScript                                     | Cross-app types and constants (`ForcedPersonaKey` etc.) |
| `packages/ui`                | React                                          | Shared low-level component primitives                   |
| `packages/eslint-config`     | —                                              | Shared lint rules                                       |
| `packages/typescript-config` | —                                              | Shared `tsconfig` bases                                 |

## Deep dives (start here for any real work)

- **UI / design routing + shared brand rules** → `@DESIGN.md`
- **Web UI design system** → `@apps/web/DESIGN.md`
- **Admin UI design system** → `@apps/admin-ui/DESIGN.md`
- **Web frontend (Next.js)** → `@apps/web/AGENTS.md`
- **Mobile development + release branches** → `@apps/mobile/AGENTS.md`
- **Agent OS (target Agent product)** → `@apps/agent-os/AGENTS.md` and
  `@docs/agent-os/README.md`. Nest control plane:
  `apps/server/src/agent-os-gateway` (`AGENT_OS_ENABLED=true`). Design authority:
  `@docs/FizzDragon_AI_Agent_Platform_Production_Guide.md`.
- **Legacy Agent (Mastra)** → `@apps/agent/AGENTS.md` — freeze; no new features

**New Agent work targets `apps/agent-os` only.** Do not import from or add
coupling to `apps/agent`.

- **NestJS server** → no AGENTS yet; conventions live in code comments
  and `apps/server/README.md` (TODO: write one).

If your task touches UI in any meaningful way, **root `DESIGN.md` is the
entry point, not the full visual spec**. Read it first for shared brand
and cross-app rules, then read the app-level `DESIGN.md` for the surface
you are changing. Do not apply the web/marketing design language to
`admin-ui`, and do not apply the internal admin-console language to
public creator surfaces.

## Production deployment

### Local validation and deployment ownership (2026-09-28)

Isaac and Yuanzheng own deployments. There is currently no staging or
canary environment: deployment goes directly to production. Run feasible
local checks, then hand off environment-dependent validation to the leads
for testing after deployment. Do not copy production secrets into local
configuration to enable those tests. Real R2 access is currently unavailable
locally; Isaac is following up on the six missing variables. Report exactly
which checks ran: type checks and unit tests do not imply a browser smoke
test passed. Missing R2 configuration does not by itself require blocking
the handoff, and does not excuse unrelated failing local checks.
Isaac confirmed (2026-09-30): run local development and browser checks for
features that do not depend on R2 or Ably even when those services are absent.
Report service-dependent checks separately; do not treat missing integrations
as a blanket blocker for local validation.

Two production deployments running off the same monorepo:

- **`fizzdragon.com`** — international (Singapore / OSS-AP-Southeast-1)
- **`fizzdragon.fizzspace.cn`** — China (Alibaba Cloud CN, separate OSS)

COM runs on **Azure AKS**, deployed through ACR builds and ArgoCD. CN runs
on **Aliyun ACK**, with images built on a separate ECS host. Follow the
region-specific commands in `README.md`; deployment credentials and migration
steps differ. The Java services remain external. CN is not a mirror: Java
backends, storage and AI credentials differ. Region-aware behaviour gates off
`NEXT_PUBLIC_SITE_REGION` (`global` vs `cn`).

Branches:

- `develop` — **default working branch** (commit + push here)
- `main` — production; merge from develop on explicit request only
- `feat/*` — optional, for risky multi-file refactors or AI-driven
  large changes; otherwise commit on develop directly

**Mobile ownership (latest user/Pax direction, 2026-10-06):** Hu Xuan
(`sleepy202411`) owns Mobile development, including the scrolling screen.
Ric focuses on Web, especially My Income / My Contracts and Pax's spreadsheet
acceptance checks. Do not continue Mobile implementation or push Mobile feature
branches under the earlier parity authorization. Shared backend changes for Web
must preserve existing Mobile API contracts. Follow `apps/mobile/AGENTS.md`.

## Commands at the repo root

```bash
npm install        # workspaces auto-resolve
npm run dev        # → turbo dev (starts web + server + agent in parallel)
npm run build      # → turbo build
npm run check-types# → turbo check-types
npm run lint       # → turbo lint
npm run format     # prettier across all packages
```

Per-app commands run from each app dir (e.g. `apps/web && npm run dev`).

## Conventions that span apps

### i18n

User-facing strings are **English-first**. `apps/web/messages/{en-US,zh-CN,zh-HK}.json`
is the single source. Never hardcode Chinese (or any non-English) in
TSX — even when editing a Chinese-heavy file, the new string goes
through i18n. Translations land in the same PR.

### Git

- **No auto-commit.** Don't `git commit` unprompted — wait for explicit
  ask.
- **No auto-merge to main.** Commit + push to `develop` is the default;
  merge develop → main only when the user says so. Mobile follows the
  feature-branch exception above.
- Commit message style: `<type>(<scope>): <short>` body free-form. See
  `git log --oneline` for examples.

### Product ownership and self-review — Pax and Isaac's direction

Pax's product direction and Isaac's technical guidance are authoritative
for implementation and review, as explicitly reconfirmed by the user.
Follow their latest applicable guidance over older project assumptions.
If their directions conflict or leave a material rule undefined, identify
the specific ambiguity instead of inventing a product or technical rule.
User instructions remain the final authority.

Apply this direction throughout implementation and review:

- **Use the product as its user.** Walk complete journeys as a Crew owner,
  project creator, applicant and contributor. Check the next action, context,
  permissions and outcome across pages, not only each component in isolation.
- **Own the review before handoff.** Run feasible local browser walkthroughs
  and inspect the rendered UI. Include empty/loading/error states, editing,
  saved drafts, navigation, return visits and interrupted work. Fix confirmed
  problems before asking Pax to review; missing external services do not
  excuse skipping independent checks.
- **Keep the experience clean and coherent.** Match the surrounding platform's
  typography, spacing, colors, navigation and interaction patterns. Every
  visible control must have a useful, understandable purpose. Remove redundant
  controls, dead ends and unfinished placeholder copy; preserve useful recovery
  actions and user-created drafts/data. Do not invent unsupported functionality.
- **Repair useful UI rather than hiding failures.** Trace non-working controls
  through their route, state and API contracts; fix and exercise the complete
  flow. Remove a control only when it is redundant or intentionally outside
  the agreed product scope. Missing integrations must be reported explicitly,
  not disguised as completed repairs by hiding the affected UI.
- **Separate evidence from assumptions.** Report exactly what was exercised,
  what used fixtures and what still needs real accounts, devices or services.
  Passing tests does not establish whole-product usability or Pax's acceptance.
  Do not declare development exhausted or wholly externally blocked while
  independent implementation or validation remains possible.
- **Keep scope and issues clear.** Distinguish agreed missing functionality,
  external acceptance and proposed features requiring product decisions.
  Reconcile issues against current evidence; use one concise bullet-point
  description per issue and add zero comments. Remove completed items from
  remaining-work lists; close only when the issue's acceptance is satisfied.

### Engineering standards (the bar for non-trivial work)

- **Build for the target state — no hedged half-measures.** Don't ship
  "MVP / demo / placeholder for now" or backwards-compat fallbacks by
  default. When existing code or schema is wrong for the target, refactor
  it head-on instead of working around it.
- **Senior architect + engineer quality.** Optimize for stability,
  fluidity, scalability, **decoupling**, and robustness — not just
  "it runs". Provide extremely smooth UX.
- **Required config fails loud.** A must-set env var (secret / credential
  / region selector) gets NO silent low default — fail at boot/readiness
  when it's missing. Operational _tuning_ knobs may keep sensible defaults.
- **Slow, steady, meticulous.** Work from the real current code (read it;
  don't guess from memory). Land changes in independently-verifiable units
  (tsc + lint + tests). For correctness-critical, browser-untestable, or
  intricate logic, run an adversarial review before building on it.
- **UI is full-fidelity.** Match reference designs completely; the only
  acceptable omission is NOT faking UI for a backend that doesn't exist
  yet. Follow the app's `DESIGN.md` (studio = dark, zero-chroma monochrome,
  no decorative orbs, brand red only as a deliberate accent).
- **Never touch the production / remote database in local dev** without
  explicit instruction. The local Postgres (`localhost:5433`) is yours to
  modify freely — migrate / seed / reset it as needed; a remote or prod DB
  is off-limits unless the user says so.
- **Don't commit or merge unprompted** (see Git above) — finish, then
  wait for review.

### Cross-package imports

`@repo/shared` is the only cross-cutting package most apps need. Its
exports are types + constants — no React, no fetcher logic. If you find
yourself wanting to share a hook or component, ask before lifting:
duplicate per-app first, lift only when there are 2+ proven consumers.

### Backend payload contracts

Java services return `{ code, msg, data }` envelopes inside HTTP 200.
Treat `code !== 200` as failure even when HTTP is fine. The shared
`api.post(..., { raw: true })` opt-in returns the full envelope so
callers can inspect `code` / `msg`. See `apps/web/src/lib/api.ts`.

### Error reporting

UI surfaces backend errors verbatim — see root `DESIGN.md § Error
Toasts` for the canonical cross-app pattern. Don't replace upstream
error messages with generic localized fallbacks (the user needs the
actionable detail).

## Skills

Some tasks benefit from loaded skills:

- `mastra` — required when touching anything under `apps/agent`. Mastra
  APIs change between versions; the skill reads docs from `node_modules`.
- `claude-api` — for prompt caching, model migration, Anthropic SDK use.
- `find-skills` — discover new skills if a task isn't covered above.

## Memory

If you're operating with persistent memory (e.g. Claude Code's
auto-memory), the project memory lives at
`~/.claude/projects/-Users-isaac-workspace-fizzdragon-fizzdragon-platform/memory/`.
Recurring conventions, known bugs, parked refactors, and per-user
preferences are tracked there. Always check `MEMORY.md` index before
starting a non-trivial task.

## Iteration

This doc is a navigation hub. When something here gets too detailed,
push it down into the app-specific AGENTS.md or DESIGN.md. Keep this
file under ~200 lines — it should be readable in one scroll.

## Historical parity integration (2026-10-06)

The previously authorized parity integration was published as `b3b673b7d`.
It is completed history, not continuing Mobile authorization. The later Mobile
ownership handoff above supersedes the earlier parity scope and branch rules.
