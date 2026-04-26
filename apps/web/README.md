# FizzDragon Platform — Web

Next.js 16 (App Router) frontend for the FizzDragon AI animation studio.
React 19.2, Tailwind v4, Turbopack default.

> Detailed conventions live in [`AGENTS.md`](./AGENTS.md). This README is
> the human entry point — read it first, skim AGENTS for specifics.

## Quickstart

```bash
# from the repo root
pnpm install                         # or npm install
cp apps/web/.env.local apps/web/.env # the tracked .env.local has dev defaults
pnpm --filter @fizzdragon/web dev    # → http://localhost:3000
```

The per-environment `.env.{local,staging,production.cn,production.com}`
files are already tracked in git; you don't need to chase Slack for them.
**Do not add infrastructure secrets** (DB / OSS-write / JWT / cloud SDK
keys) to those files — those go in 1Password/Vault.

## Project layout

```
apps/web/
├── app/                  Routes (App Router)
│   ├── (site)/           Marketing/site shell with GlobalNav + SiteFooter
│   │   ├── about/        Static pages (about, news, ips, crews, …)
│   │   └── courses/      Migration WIP — see app/(site)/courses/README.md
│   ├── (auth)/           Login / signup
│   ├── studio/           Authenticated app shell (creator center)
│   ├── workbench/        Storyboard / script / timeline editor
│   ├── projects/         Project list + AI assistant
│   └── layout.tsx        Root layout (theme, fonts, locale html lang)
├── components/           Shared UI
│   ├── ui/               shadcn primitives + custom ones
│   ├── layout/           GlobalNav, SiteFooter, UserMenu, …
│   └── payment/          Upgrade / recharge dialogs
├── messages/             i18n strings (en-US, zh-CN, zh-HK)
├── src/
│   ├── i18n/             Locale config (default en-US, see below)
│   ├── lib/api.ts        backendApi helper — use this for all fetches
│   ├── store/            Redux Toolkit slices (auth, …)
│   └── hooks/            useUserInfo, useCredits, …
├── proxy.ts              Locale URL rewrite (was middleware.ts in Next 15)
└── next.config.ts        Backend rewrites (proxy table below)
```

## Locales

- Default **en-US** has no URL prefix: `/projects`, `/ip/123`.
- Other locales prefixed: `/zh-CN/projects`, `/zh-HK/ip/123`.
- `proxy.ts` strips the prefix internally and attaches `x-locale` header
  for server components.
- Add new copy under `apps/web/messages/{en-US,zh-CN,zh-HK}.json`. Default
  to English; never introduce new Chinese string literals in TSX/TS code.

## Backend proxy

`next.config.ts` rewrites these prefixes to backend services:

| Prefix                              | Target                             |
| ----------------------------------- | ---------------------------------- |
| `/aurora/*`                         | NestJS server (`SERVER_URL`)       |
| `/api/*`, `/anon/*`, `/studio/*`    | Java Studio (`JAVA_STUDIO_URL`)    |
| `/user/*`, `/project/*`, `/vedio/*` | Java Content (`JAVA_CONTENT_URL`)  |
| `/newsapi/*`                        | `https://fizzdragon.com/content/*` |

Just call `backendApi.get('/project/list/course/type/title')` — no manual
host prefix; the rewrite handles it per-environment.

## Migration in progress

Pages are being ported from the legacy `fizzdragon-web` (uni-app + Vue 2)
repo. For each non-trivial page, drop a `README.md` next to the new route
documenting the legacy source path, the URL mapping, and the backend
endpoints used. Example: [`app/(site)/courses/README.md`](<./app/(site)/courses/README.md>).

Migration status lives in the team auto-memory (`project_migration_status`);
update it on ship.

## Common scripts

```bash
pnpm --filter @fizzdragon/web dev          # dev server (port 3000)
pnpm --filter @fizzdragon/web build        # production build
pnpm --filter @fizzdragon/web check-types  # tsc --noEmit
pnpm --filter @fizzdragon/web lint         # next lint
```

> `next.config.ts` has `typescript.ignoreBuildErrors: true` for now —
> there are pre-existing type errors inherited from the TanStack Start
> version. New code should pass `check-types`.

## Build & deploy

Docker images are built locally and pushed to GHCR; servers `pull` and
restart via Compose. Full procedure (with env-specific build args, server
IPs, and rollout commands) lives in [`deploy/DEPLOY.md`](../../deploy/DEPLOY.md).
