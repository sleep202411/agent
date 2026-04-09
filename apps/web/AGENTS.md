# TanStack Start + Vite

This app uses TanStack Start (not Next.js). Routing is file-based via TanStack Router under `src/routes/`.

Key conventions:

- `$locale.tsx` — dynamic locale layout, validates locale and syncs i18next
- `_studio.tsx` — pathless layout (sidebar + header)
- `_auth.tsx` — pathless layout (centered auth)
- `projects_.$id.tsx` — non-nested route (no studio sidebar)
- `LocaleLink` / `useLocalePath` — auto-prefix locale to paths
- i18n: i18next + react-i18next, locale in URL (`/$locale/...`)
- Env vars: `VITE_*` prefix, accessed via `@/src/env`
