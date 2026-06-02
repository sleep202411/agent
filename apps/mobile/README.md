# FizzDragon Mobile

Expo / React Native mobile client for FizzDragon creator workflows. The old
Vue / uni-app project is an API and feature reference only; this app owns its
own route, theme, auth, and native configuration.

## Commands

Run from the monorepo root:

```bash
npm install
npm run start --workspace mobile
npm run web --workspace mobile
npm run android --workspace mobile
npm run ios --workspace mobile
```

Region-specific local starts:

```bash
npm run start:global --workspace mobile
npm run start:cn --workspace mobile
```

## Environment

Runtime and native app identity are configured in `app.config.js`.

- `FD_APP_REGION`: `global` or `cn`
- `APP_VARIANT`: `development`, `preview`, or `production`
- `FD_GLOBAL_IOS_BUNDLE_IDENTIFIER` / `FD_GLOBAL_ANDROID_PACKAGE`: global production IDs
- `FD_CN_IOS_BUNDLE_IDENTIFIER` / `FD_CN_ANDROID_PACKAGE`: China production IDs

Production builds fail fast if the relevant bundle identifier or Android package is missing. Development and preview builds use placeholder IDs until the real package names are supplied.

Public API and asset endpoints are baked into the JS bundle through Expo config `extra.appEnv`. See `.env.example` for local defaults. The default API bases mirror the web proxy table:

- `contentBaseUrl`: `/content/*` → Java Content
- `studioBaseUrl`: `/studio/*` → Java Studio
- `auroraBaseUrl`: `/aurora/*` → NestJS server

## Auth

Auth lives under `src/auth` and requests go through `src/lib/api-client.ts`.

- Login supports email and phone identifiers against the existing Java user
  endpoints.
- Java response envelopes are handled centrally. Envelope `302` and `401` both
  clear the local session.
- Native sessions are stored in `expo-secure-store`; web preview stores the
  same session shape in `localStorage`.
- Requests include `Authorization: Bearer <token>`, `accept-language`, and
  `lan` headers for compatibility with the web and legacy Vue clients.
- The login route is outside the main tab shell: `/login` is a root stack
  screen, while `/` and `/explore` live inside `(tabs)`.

## Theme

NativeWind is configured through `tailwind.config.js`, `babel.config.js`, and `metro.config.js`. FizzDragon mobile tokens live in `src/config/theme-tokens.json`; use those tokens before adding one-off colors or spacing.
