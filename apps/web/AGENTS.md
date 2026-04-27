# Next.js 16 App Router

This app uses **Next.js 16** (App Router) with **React 19.2** and **Tailwind v4**.
Turbopack is the default bundler — no flags needed.

> **Heads up:** Next.js 16 has breaking changes vs. earlier versions. Skim
> `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` before
> writing anything non-trivial.

## Key conventions

- **Routing**: file-based under `app/`. Groups `(foo)/` are pathless (don't
  affect URL). Dynamic segments use `[id]` (brackets). Layouts live in
  `layout.tsx`, pages in `page.tsx`.
- **Client/server**: every file is a Server Component by default. Add
  `"use client";` at the top of any file that uses hooks / browser APIs / Redux.
  Most of this app is interactive, so nearly everything under `app/` and
  `components/` is client.
- **Async params**: `params` and `searchParams` in pages are Promises. Use
  `await props.params` in server components, or `useParams()` / `useSearchParams()`
  from `next/navigation` in client components.
- **Navigation**: `import Link from "next/link"`, `useRouter()`, `usePathname()`,
  `useParams()`, `useSearchParams()` — all from `next/navigation` (client only).
- **Middleware → Proxy**: Next.js 16 renamed `middleware.ts` → `proxy.ts`,
  exports a `proxy` function. See `proxy.ts` for the locale-rewrite logic.

## Locale / i18n

- **All locales carry a URL prefix**: `/en-US/projects`, `/zh-CN/projects`,
  `/zh-HK/ip/123`. Default is `en-US`.
- Hitting an unprefixed path (`/projects`, `/`) 308-redirects to the
  default-locale prefix (`/en-US/projects`, `/en-US`).
- `proxy.ts` strips the prefix internally (so pages route as if no prefix),
  and sets `x-locale` header for server components to read.
- Translations: i18next + react-i18next. `useTranslations("ns")` + `useLocale()`.

## Env vars

- **`NEXT_PUBLIC_*`** vars are inlined at build time (client-accessible).
- Server-only vars (without prefix): `SERVER_URL`, `JAVA_STUDIO_URL`,
  `JAVA_CONTENT_URL`. Used in `next.config.ts` rewrites and server code.
- Access via `@/src/env` (throws if required vars are missing at build).

## Backend proxy

`next.config.ts#rewrites` proxies backend paths:

- `/aurora/*` → NestJS (`SERVER_URL`)
- `/api/*`, `/anon/*`, `/studio/*` → Java Studio (`JAVA_STUDIO_URL`)
- `/user/*`, `/project/*`, `/vedio/*` → Java Content (`JAVA_CONTENT_URL`)

**No public Next.js HTTP endpoints.** Anything the web app needs to
fetch / merge / sanitize on the server side is done as part of an
`async` server component, not as a route handler. nginx on prod
forwards `/api/*` directly to Java Studio, so exposing a `/api/*` route
handler doesn't work end-to-end anyway — and SSR gives us SEO + faster
first paint for free. If a true HTTP endpoint is ever needed (webhook,
external consumer), pick a fresh non-conflicting prefix and add an
nginx rule.

## Feature colocation (work-in-progress convention)

The IP feature (`app/(site)/ips/`) is the **reference implementation** of
the project's chosen architecture: each feature owns its data layer.

```
app/(site)/ips/
├── _hooks/
│   └── use-ip.ts        ← types, fetchers, query keys, hook wrappers
├── _data/
│   ├── ip.ts            ← UI types and config constants for IP forms / cards
│   └── interactive.ts   ← types for the interactive video graph editor
├── _components/         ← React components only — no data, no mocks
├── [id]/                ← detail / edit / episodes routes
├── create/              ← creation flow
└── page.tsx             ← IP Plaza listing
```

**What lives feature-private (under `app/(feature)/_*/`):**

- Types and constants only the feature uses (`IPItem`, `IPDetail`,
  `STAGE_CONFIG`, `PRESET_REWARDS`, …).
- React Query hook wrappers and cache keys for endpoints the feature
  consumes — even when the underlying service function is shared.
- Fetchers for endpoints only the feature talks to.

**What stays in `src/` (app-level shared infrastructure):**

- `src/services/<domain>.ts` — transport-level service functions reused
  across multiple features (e.g., `updateProject` is called by both
  `(site)/ips/[id]/edit` and `(site)/profile`). The service stays
  shared; each feature wraps it in its own hook.
- `src/hooks/` — hooks for genuinely cross-cutting domains (auth, current
  user, certification, KYC). Don't put a hook here unless two or more
  features need it.
- `src/lib/`, `src/i18n/`, `src/env.ts`, `src/store/` — universal app
  plumbing.

**The rule of thumb:** does a second feature already need this? If yes,
shared. If no, feature-private — promote to `src/` later if a real second
consumer appears, don't predict sharing in advance.

**Older code under `src/hooks/` (e.g., `use-my-projects`, `use-episodes`,
`use-worlds`) predates this convention.** Those will be migrated into
their respective features over time. Until then expect a mix; for new
work, follow the IP layout.

## Dev

```bash
npm run dev  # → next dev --port 3000 (Turbopack by default)
npm run build
npm run check-types
```

## Known debt

- `next.config.ts` sets `typescript.ignoreBuildErrors: true` because of
  pre-existing type errors in `storyboard-save.ts`, `interactive-node.tsx`,
  `chat-toolbar.tsx`, etc. — inherited from the TanStack Start version, not
  introduced by the migration. Clean these up separately.
