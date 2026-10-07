# Next.js 16 App Router

This app uses **Next.js 16** (App Router) with **React 19.2** and **Tailwind v4**.
Turbopack is the default bundler — no flags needed.

> **Heads up:** Next.js 16 has breaking changes vs. earlier versions. Skim
> `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` before
> writing anything non-trivial.

## Design system

Read `../../DESIGN.md` first for shared FizzDragon brand rules, then read
`DESIGN.md` in this directory for the web-specific design system. This app owns
the public and creator-facing FizzDragon experience; do not import the
admin-console design language from `apps/admin-ui`.

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
- React Query hook wrappers and cache keys for the endpoints the
  feature consumes.
- The fetcher implementations themselves — wire URL, request shape,
  response parsing.

**What stays in `src/` (app-level shared infrastructure):**

- `src/lib/`, `src/i18n/`, `src/env.ts`, `src/store/` — universal app
  plumbing (transport client, env config, redux, i18n).
- `src/hooks/` — hooks for genuinely cross-cutting domains (auth,
  current user, certification, KYC). Don't put a hook here unless two
  or more features already need it.

**The rule of thumb:** **feature-private wins, even if it duplicates
code.** If two features end up calling the same backend endpoint, each
owns its own fetcher, types, and cache keys. Promotion to `src/`
happens only when someone makes an explicit decision to share — never
preemptively. Two divergent local copies are cheaper than one shared
abstraction that's wrong for both callers.

This is a deliberate inversion of the usual DRY instinct. The rationale:
shared service modules in `src/services/` accreted IP-specific shapes
that other consumers (profile, creators) accidentally couplied to,
making it impossible to evolve the IP wire contract without breaking
unrelated features. Feature-local fetchers eliminate that
cross-coupling at the cost of some line duplication.

**Older code under `src/hooks/` and `src/services/`** predates this
convention. It still works for the consumers it has, but new work
should never reach into it; build feature-local instead. Migrate the
old code only when its current consumer is being refactored anyway.

## Dev

```bash
npm run dev  # → next dev --port 3000 (Turbopack by default)
npm run build
npm run check-types
```

## Legacy fizzdragon-web bundle (strangler-fig — to be retired)

The legacy uni-app H5 (`fizzdragon-web` repo) is bundled into this app's
`public/` so unmigrated routes can serve from the same origin without
an iframe across deploys. The platform owns rendering — legacy is
embedded inside the platform's `(site)/layout.tsx` chrome via an
iframe wrapper.

**Files / paths added solely to support legacy.** When fizzdragon-web
is fully ported into native Next.js routes and the bundle is no longer
needed, **delete every item below** in one cleanup PR — none of it has
non-legacy use:

- `apps/web/scripts/sync-legacy.mjs` — sync script
- `apps/web/public/legacy.html` — bundle entry point (regenerated by
  the script)
- `apps/web/public/assets/` — bundle JS/CSS chunks (regenerated)
- `apps/web/public/static/` — bundle static assets (regenerated)
- `apps/web/app/(site)/[...legacyPath]/page.tsx` — catch-all page
  rendering the iframe wrapper
- In `apps/web/proxy.ts`: the `__legacy` exclusion in the matcher
  (the only locale-bypass left after legacy is gone is for static
  assets and API proxies)
- In `apps/web/next.config.ts`: the `/__legacy/:path*` →
  `/legacy.html` rewrite under `afterFiles`
- In `apps/web/package.json`: the `legacy:sync` npm script (if added)

After deletion, hitting an unmatched URL should 404 — that's the
desired behaviour once every page lives in `app/(site)/...`.

The catch-all at `[...legacyPath]/page.tsx` is the visible signal
that legacy still lives; it competes with native routes by being less
specific, so as long as that file exists the strangler-fig is in
flight. Removing it (and the rest above) is the final cutover.

## Known debt

- `next.config.ts` sets `typescript.ignoreBuildErrors: true` because of
  pre-existing type errors in `storyboard-save.ts`, `interactive-node.tsx`,
  `chat-toolbar.tsx`, etc. — inherited from the TanStack Start version, not
  introduced by the migration. Clean these up separately.
