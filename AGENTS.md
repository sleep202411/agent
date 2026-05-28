# AGENTS.md — FizzDragon Platform

Repo-level orientation for AI coding agents and humans new to the
monorepo. Scope is **navigation + cross-cutting conventions only** —
each `apps/*` and `packages/*` ships its own deep guide.

## Architecture

Three-app monorepo behind one product (FizzDragon — AI animation /
storyboard / IP co-creation platform). The user-facing brand is
**FizzDragon** in English copy; **气泡龙** is the Chinese transliteration
for zh-CN / zh-HK locales only.

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
│ /aurora/* routes   │  │ Image / video gen, billing,    │
│ Proxies to Agent   │  │ user / project / video CRUD    │
└────────┬───────────┘  └────────────────────────────────┘
         │
         ▼
┌────────────────────┐
│ Agent (Mastra)     │
│ StoryOS supervisor │
│ + ask_* personas   │
│ Workflows + queues │
└────────────────────┘
```

| Path                         | Stack                                          | Purpose                                                 |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `apps/web`                   | Next.js 16 App Router, React 19.2, Tailwind v4 | User-facing site + studio UI                            |
| `apps/server`                | NestJS                                         | Session, chat WS, proxies to Agent, billing glue        |
| `apps/agent`                 | Mastra + AI SDK                                | StoryOS supervisor + 6 specialist personas, workflows   |
| `packages/shared`            | TypeScript                                     | Cross-app types and constants (`ForcedPersonaKey` etc.) |
| `packages/ui`                | React                                          | Shared low-level component primitives                   |
| `packages/eslint-config`     | —                                              | Shared lint rules                                       |
| `packages/typescript-config` | —                                              | Shared `tsconfig` bases                                 |

## Deep dives (start here for any real work)

- **UI / design routing + shared brand rules** → `@DESIGN.md`
- **Web UI design system** → `@apps/web/DESIGN.md`
- **Admin UI design system** → `@apps/admin-ui/DESIGN.md`
- **Web frontend (Next.js)** → `@apps/web/AGENTS.md`
- **Agent backend (Mastra)** → `@apps/agent/AGENTS.md`
- **NestJS server** → no AGENTS yet; conventions live in code comments
  and `apps/server/README.md` (TODO: write one).

If your task touches UI in any meaningful way, **root `DESIGN.md` is the
entry point, not the full visual spec**. Read it first for shared brand
and cross-app rules, then read the app-level `DESIGN.md` for the surface
you are changing. Do not apply the web/marketing design language to
`admin-ui`, and do not apply the internal admin-console language to
public creator surfaces.

## Production deployment

Two production deployments running off the same monorepo:

- **`fizzdragon.com`** — international (Singapore / OSS-AP-Southeast-1)
- **`fizzdragon.fizzspace.cn`** — China (Alibaba Cloud CN, separate OSS)

Both are Alibaba Cloud ECS hosted. The CN deployment is **not** a
mirror — env vars differ (different Java backends, different OSS
buckets, different AI keys). Region-aware behaviour gates off
`NEXT_PUBLIC_SITE_REGION` (`global` vs `cn`).

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
