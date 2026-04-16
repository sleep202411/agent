# TanStack Start + Vite

This app uses TanStack Start (not Next.js). Routing is file-based via TanStack Router under `src/routes/`.

Key conventions:

- i18n uses `rewrite` pattern: default locale (zh-CN) has no URL prefix, others get prefixed (`/en-US/...`, `/zh-HK/...`)
- `src/i18n/locale-url.ts` — `deLocalizeUrl`/`localizeUrl` for router rewrite
- Links use plain paths (`/projects`, not `/${locale}/projects`) — router rewrite adds locale prefix automatically
- `_studio.tsx` — pathless layout (sidebar + header)
- `_auth.tsx` — pathless layout (centered auth)
- `projects_.$id.tsx` — non-nested route (no studio sidebar)
- i18n: i18next + react-i18next
- Env vars: `VITE_*` prefix, accessed via `@/src/env`
