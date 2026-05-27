# FizzDragon Admin UI

Internal operations console for FizzDragon. This app is intentionally separate
from `apps/web` and does not use the legacy Java admin auth flow.

## Commands

```bash
npm run dev -w admin-ui
npm run lint -w admin-ui
npm run check-types -w admin-ui
npm run build -w admin-ui
```

Local URL: http://localhost:9530

## Stack

- Next.js 16 App Router
- React 19
- Tailwind v4
- shadcn/ui v4 with Radix primitives
- Sonner toasts
- TanStack Table, React Hook Form, and Zod for future data grids/forms

## Site Boundary

The admin UI is one codebase, but `.com` and `.cn` are separate sites with
separate admin APIs and databases. The site selector changes the API base URL;
it is not a tenant filter inside one shared database.

Configure API bases with:

```bash
NEXT_PUBLIC_ADMIN_GLOBAL_API_BASE=https://api.fizzdragon.com/aurora/admin
NEXT_PUBLIC_ADMIN_CN_API_BASE=https://fizzdragon.fizzspace.cn/aurora/admin
```

Payment and currency are server-derived per site:

- `.com` uses Airewa and international settlement rules.
- `.cn` uses WeChat Pay and CNY settlement rules.

Browsers should not submit trusted currency values.
