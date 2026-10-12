# AGENTS.md — FizzDragon Platform

Repo-level orientation for AI coding agents and humans new to the
monorepo. Scope is **navigation + cross-cutting conventions only** —
each `apps/*` and `packages/*` ships its own deep guide.

## Architecture

Multi-app monorepo behind one product (FizzDragon — AI animation /
storyboard / IP co-creation platform). The user-facing brand is
**FizzDragon** in every language, including zh-CN / zh-HK. Do not translate
or transliterate the brand name.

Web and Studio render the product and talk to Nest through `/aurora/*`.
Nest owns sessions, authorization, realtime, billing integration and the Agent OS
Gateway. Agent OS runs its own agent platform; the independent Game Agent runs
official Harness. External Java services provide their existing user, project,
content and generation APIs. Keep these service boundaries explicit.

| Path                         | Stack                                          | Purpose                                                          |
| ---------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `apps/web`                   | Next.js 16 App Router, React 19.2, Tailwind v4 | User-facing site + studio entry                                  |
| `apps/studio`                | Next.js / React                                | Creator canvas and story-authoring UI                            |
| `apps/admin-ui`              | Next.js / React                                | Internal operations console                                      |
| `apps/server`                | NestJS                                         | Session, chat WS, Agent OS Gateway, billing glue                 |
| `apps/agent-os`              | LangGraph.js + LiteLLM                         | **FizzDragon Agent Platform** (codename Agent OS) — NEW          |
| `apps/app-story-agent`       | Official Harness + React H5                    | App-only interactive-film Agent and dedicated conversation UI    |
| `apps/game-agent`            | Official DeepSeek Harness                      | Independent game-authoring Agent; no Agent OS runtime dependency |
| `apps/agent`                 | Mastra + AI SDK                                | Legacy StoryOS — do not extend                                   |
| `packages/agent-protocol`    | TypeScript + Zod                               | Agent OS wire protocol (`fizz.agent.v1`)                         |
| `packages/agent-policy`      | TypeScript                                     | Agent OS approval / risk policy                                  |
| `packages/shared`            | TypeScript                                     | Cross-app types and constants (`ForcedPersonaKey` etc.)          |
| `packages/ui`                | React                                          | Shared low-level component primitives                            |
| `packages/eslint-config`     | —                                              | Shared lint rules                                                |
| `packages/typescript-config` | —                                              | Shared `tsconfig` bases                                          |

## Deep dives (start here for any real work)

- **UI / design routing + shared brand rules** → `@DESIGN.md`
- **Web UI design system** → `@apps/web/DESIGN.md`
- **Admin UI design system** → `@apps/admin-ui/DESIGN.md`
- **Web frontend (Next.js)** → `@apps/web/AGENTS.md`
- **Agent OS (target Agent product)** → `@apps/agent-os/AGENTS.md` and
  `@docs/agent-os/README.md`. Nest control plane:
  `apps/server/src/agent-os-gateway` (`AGENT_OS_ENABLED=true`). Design authority:
  `@docs/FizzDragon_AI_Agent_Platform_Production_Guide.md`.
- **Legacy Agent (Mastra)** → `@apps/agent/AGENTS.md` — freeze; no new features

**Platform Agent work targets `apps/agent-os` only.** Do not import from or add
coupling to `apps/agent`. The user's explicit game-authoring exception is
`apps/game-agent`: Harness owns that independent agent loop. See its
`AGENTS.md` and `README.md`; do not fold it back into Agent OS. The separately
authorized App-only story flow lives in `apps/app-story-agent`; its React H5
and Harness worker share that project, with separate builds. See its
`AGENTS.md`, `README.md` and `DESIGN.md`. Server retains business API ownership.

- **NestJS server** → no AGENTS yet; conventions live in code comments
  and `apps/server/README.md` (TODO: write one).

If your task touches UI in any meaningful way, **root `DESIGN.md` is the
entry point, not the full visual spec**. Read it first for shared brand
and cross-app rules, then read the app-level `DESIGN.md` for the surface
you are changing. Do not apply the web/marketing design language to
`admin-ui`, and do not apply the internal admin-console language to
public creator surfaces.

## Production deployment

Two production deployments use this monorepo:

- **`.com`** — Alibaba Cloud Singapore ACK, account `5332868355276356`,
  profile `acct6`, region `ap-southeast-1`, cluster `fizzdragon-com-sg`,
  namespace `fizzdragon`. Six active services: Web, Server, Studio, Admin UI,
  Agent OS and Harness/Game Agent. Managed cloud publishing uses the single
  entrypoint `deploy/deploy-com.sh`; see `deploy/aliyun-sg/README.md` for the
  `main` push webhook and Flow job configuration. The job supplies temporary ACK
  and ACR credentials; colleagues need no local cloud profile or ECS Runner.
  Normal releases require clean `main` and build its fixed committed HEAD;
  `--check` is read-only and does not require that branch state.
- **`.cn`** — Alibaba Cloud Hangzhou ACK, cluster `fizzdragon-cn`, with its own
  account, VPC, PostgreSQL, Redis, OSS and `deploy/deploy-cn.sh` workflow.

The sites use different runtime configuration, Java endpoints, storage and AI
credentials. Region-aware behavior uses `NEXT_PUBLIC_SITE_REGION` (`global`
versus `cn`). Do not mix accounts or deployment inputs.

The `.com` root domain and `www` retain Azure Front Door; legacy Azure Blob media
remains readable and new global outputs use R2. Java/MySQL stays in its separate
account `5941647929258385`. Azure application writers and automatic reconciliation
remain stopped; do not use the retired AKS entrypoint or preparation overlays for
production releases.

Branches:

- `develop` — **default working branch** (commit + push here)
- `main` — production; merge from develop on explicit request only
- `feat/*` — optional, for risky multi-file refactors or AI-driven
  large changes; otherwise commit on develop directly

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
  merge develop → main only when the user says so.
- Commit message style: `<type>(<scope>): <short>` body free-form. See
  `git log --oneline` for examples.

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

## Iteration

This doc is a navigation hub. When something here gets too detailed,
push it down into the app-specific AGENTS.md or DESIGN.md. Keep this
file under ~200 lines — it should be readable in one scroll.

## Native Courses handoff — 2026-10-07

- The user's temporary Mobile exception reopened native Courses. Catalogue,
  search, lessons, playback/resume and Academy certificate mappings now use the
  regional Web APIs; Home, Creators, Crews, Courses and Mine are the five tabs.
- The native Courses deferral is superseded. The separate daily Discovery
  assistant remains deferred pending Pax's final design. Watching a course
  does not award a certificate; real course/badge assignments belong in Admin.
- Local tests, type/lint checks, regional browser fixtures and native bundle
  exports validate this integration; they do not establish production or
  physical-device acceptance.
- This integration is authorized for `main`, `develop` and
  `feat/mobile-2.4.0-scrolling-screen`, aligned without force-pushing. Afterwards,
  Hu Xuan (`sleepy202411`) owns Mobile development and device/live acceptance.
  Further Mobile implementation requires a new assignment; deployment
  assistance remains allowed.

## Academy parity handoff — 2026-10-07

- A renewed user exception covers native enrollment, homework uploads, teacher
  reviews, teaching income and withdrawals using the same regional APIs as Web.
- Release requires the platform Academy migration and the Java playback gate;
  local checks do not replace production or physical-device acceptance.
- Daily Discovery remains deferred. Hu Xuan (`sleepy202411`) retains Mobile
  ownership after this parity pass; deployment assistance remains allowed.
