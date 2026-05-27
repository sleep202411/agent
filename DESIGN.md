# FizzDragon Design System

This file is the repo-level design entry point. It is intentionally small.
App-specific product surfaces own their detailed visual language in their
own `DESIGN.md` files.

## Read Order

For any meaningful UI work:

1. Read this file first for shared brand and cross-app rules.
2. Read the app-level design file for the surface you are changing.
3. Read the app-level `AGENTS.md` for framework and architecture rules.

## App Design Files

| Surface                                                      | Design file               | Role                                                                                                                                         |
| ------------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| User-facing web, marketing, AI Lab, creator studio           | `apps/web/DESIGN.md`      | Replicate-inspired FizzDragon web experience. Warm editorial surfaces, model discovery, creator workflows, and public/product UI.            |
| Internal admin, AI Model Ops, billing, quota, routing, audit | `apps/admin-ui/DESIGN.md` | Together AI / Cohere-inspired operations console. High-density configuration, tables, filters, forms, auditability, and site-aware controls. |

Do not apply the web design language to admin surfaces. Do not apply the
admin console language to public creator surfaces.

## Shared Brand

- Product name in English copy: `FizzDragon`.
- Chinese transliteration for zh-CN / zh-HK locales only: `气泡龙`.
- Primary brand accent: `#E52227`.
- The brand accent is a signal color, not a page background. Use it for
  primary actions, selected states, focus accents, destructive confirmation,
  and important operational indicators.
- English is the source language for product copy. User-facing strings must
  go through the app i18n system.

## Product Separation

`apps/web` and `apps/admin-ui` serve different users and jobs:

- `apps/web` optimizes for external users: discovery, creation, model choice,
  creator identity, projects, IP, AI Lab, and guided workflows.
- `apps/admin-ui` optimizes for internal operators: pricing, provider costs,
  quota, model routing, campaigns, wallets, users, logs, release checks, and
  incident diagnosis.

Visual consistency comes from shared brand discipline, not from forcing both
apps into the same component rhythm.

## Global UI Rules

- Keep interfaces clear and task-oriented. Do not add decorative surfaces that
  reduce scan speed.
- Use app-level design tokens and components before inventing new ones.
- Forms must make state explicit: required, optional, invalid, saving, saved,
  disabled, destructive, and empty states should be visible without guesswork.
- Tables and lists must support operational scanning: stable columns, visible
  status, deterministic sort/filter behavior, and meaningful empty states.
- Avoid hiding broken product logic with CSS. Fix routing, layout ownership,
  and component composition at the source.
- Do not hardcode non-English user-facing strings in TSX. Add translations in
  the relevant messages files.

## Error Toasts

Backend errors should be surfaced with actionable detail.

- If the upstream returns a specific message, show that message.
- Do not replace specific backend failures with generic localized fallback
  text unless the upstream message is empty or unsafe to display.
- Preserve enough context for operators or users to report the issue: action,
  target, and upstream message.
- For admin surfaces, include identifiers such as model key, provider endpoint,
  quote id, job id, user id, or site when available.

## Site And Market Semantics

FizzDragon has separate production sites:

- `.com` is the international site.
- `.cn` is the mainland China site.

Treat these as commercial/site boundaries, not merely UI locale or deployment
region. Locale, site, deployment region, provider region, payment rail, and
currency are separate concepts.

Admin UI must make the active site explicit before showing configuration that
affects pricing, quota, billing, provider routing, or campaigns.

## Design Governance

- Root `DESIGN.md` defines shared principles only.
- App-level `DESIGN.md` files define detailed tokens, component behavior,
  layout rules, and app-specific do/don't guidance.
- When an app needs a new pattern, add it to that app's design file rather than
  expanding this root file.
- When a rule is truly cross-app, keep it short here and link to the app-level
  implementations.
