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

- Default locale **zh-CN** has **no URL prefix**: `/projects`, `/ip/123`.
- Other locales use prefix: `/en-US/projects`, `/zh-HK/ip/123`.
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
- `/newsapi/*` → `https://fizzdragon.com/content/*`

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
