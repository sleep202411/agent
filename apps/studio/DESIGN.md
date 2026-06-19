# FizzStudio Design System

FizzStudio is the standalone AI creative studio (image / video / audio
generation). It is extracted from the web app's `(fizzstudio)` surface and
will live on its own domain. It owns its own visual language: a dark,
monochrome, borderless "AI studio" interface in the imagine.art genre.

Read `../../DESIGN.md` first for shared brand rules. Where this file is
stricter than the shared rules, this file wins inside `apps/studio`.

The home / app-shell visual language — frosted panels, the rim-light edge,
mask-icon glyphs, sliding indicators, the Mono/Red accent presets, and full
component anatomy — is specced in `app/[locale]/_pollo/DESIGN.md`; the rules
below are the binding constraints it must honor.

## Non-negotiables

1. **Dark-only.** There is no light theme and no theme switching.
   - The dark palette lives directly in `:root` in `app/globals.css`.
     There is no `.dark` token block.
   - `<html>` carries a permanent `dark` class (see `app/layout.tsx`) so
     `dark:` variants from third-party registry components still apply.
     App code must NOT write new `dark:` variants — they are dead weight here.
   - `color-scheme: dark` is declared on `:root`; `viewport.colorScheme`
     is `"dark"`. Never install `next-themes`.
   - **Accent preset** (Mono / Red) is the one sanctioned user choice (signed
     off 2026-06-19): it swaps ONLY the primary-CTA accent (white ↔ brand red),
     never surfaces, and is NOT light/dark switching — still dark-only, still no
     `next-themes`. See `app/[locale]/_pollo/DESIGN.md` §2.

2. **Monochrome surfaces, zero chroma.** Every surface token is pure
   neutral (OKLCH chroma `0`). The approved scale:

   | Token        | Value              | Role                      |
   | ------------ | ------------------ | ------------------------- |
   | `background` | `oklch(0.13 0 0)`  | page                      |
   | `card`       | `oklch(0.175 0 0)` | panels, cards             |
   | `popover`    | `oklch(0.19 0 0)`  | overlays, menus, tooltips |
   | `muted`      | `oklch(0.22 0 0)`  | quiet fills               |
   | `secondary`  | `oklch(0.24 0 0)`  | secondary buttons         |
   | `accent`     | `oklch(0.25 0 0)`  | hover fills               |
   | `primary`    | `oklch(0.922 0 0)` | primary actions (white)   |
   | `border`     | `white / 8%`       | hairlines (see rule 4)    |
   | `input`      | `white / 12%`      | filled control surfaces   |

   **Canvas elevation tiers.** The canvas surface is darker than the page
   (`oklch(0.105)`), so floating panels need extra lightness to read — on
   near-black, drop shadows are invisible (nothing is darker), so separation
   is carried by the tone step alone. Layering on the canvas:
   canvas `0.105` → card `0.175` → floating composer `oklch(0.22)` →
   panels opened over the composer (model picker / settings) `oklch(0.24)`.
   All zero-chroma; no borders.

   Three deliberate exceptions, all for **functional color that encodes data,
   not decoration**:
   - `destructive` keeps standard shadcn chroma — error semantics need color.
   - **Canvas connectors** (port handles, their labels, and the edges between
     them) are colored by data type: text/prompt = blue `#5b9dff`, image =
     amber `#e0a45c`, video = brand red `#E52227` (see
     `app/canvas/_components/port-colors.ts`). Edges are gradient-stroked
     between their two endpoint colors. This is the same category as chart
     colors — it carries meaning. Node surfaces stay monochrome; only the
     wires are colored. The video connector is the one sanctioned, deliberate
     use of brand red as a functional accent (rule 3) — it is still not a
     token and never tints a surface.
   - **Commerce accents** (subscription / pricing surfaces only, decided
     2026-06-12 against the imagine.art reference): plan tiers are encoded
     with accents kept sparse — lower tiers stay neutral, blue `#3a86ff`
     marks the recommended (Popular) tier, brand red `#E52227` crowns the
     top tier; yellow `#ffbe0b` marks billing-interval savings chips.
     Accents appear as the card's tinted gradient wash, ribbon frame,
     discount chips, strikethrough prices, credit counts, check icons, and
     the glowing CTA — purchase-intent surfaces are the one place the
     monochrome rule yields to conversion, and the one sanctioned surface
     where brand red tints a card (an explicit rule-3 decision: the brand
     pushes the plan we recommend). These are hardcoded in
     `app/_components/subscription-dialog.tsx`, are NOT tokens, and must
     not leak into general chrome.

3. **Brand red is not a token.** The FizzDragon red `#E52227`
   (`oklch(0.5914 0.225 26.83)`) must never enter the global token set or
   tint neutral surfaces — a red-washed UI has been explicitly rejected.
   Red is reserved for rare, deliberate, case-by-case accents (e.g. a hero
   CTA), applied locally and only with an explicit decision. The **Red accent
   preset** is the one _systematic_ sanctioned use (signed off 2026-06-19):
   brand red fills every primary ACTION BUTTON (Generate / Start for Free / Try
   Now / Send / Blank-Canvas +); it still never joins the neutral token set and
   never tints a surface or active-state fill — only the CTA. The Mono preset
   keeps CTAs white (`primary`). Generated imagery is the only saturated content
   by default.

4. **No borders. Anywhere.** shadcn's default border-everywhere look has
   been explicitly rejected, including hairlines on chrome and floating
   panels. Separation comes from **tone steps** (`background` → `card` →
   `popover`), **shadows**, and **backdrop blur** — never from an outline.
   - Inputs / textareas / selects: `border-transparent` + translucent fill
     (`bg-input/20`–`/30`).
   - Cards, headers, rails, pills: fills only — no `border-*`, no
     decorative `ring-*`.
   - Floating panels (dropdown / popover / dialog / tooltip / toast):
     `bg-popover` + shadow, de-ringed at the component source.
   - The only permitted "borders": the **focus ring**
     (`focus-visible:ring-*`), internal **separators**
     (`h-px bg-border` dividers between rows), and variants whose _name_
     is the border (`outline` button/badge).
   - The **frosted rim-light** (signed off 2026-06-19) is a sanctioned soft
     edge — NOT an outline: a low-alpha gradient hairline masked to a 0.5–1.5px
     ring (`mask-composite: exclude`; see `_pollo/glyphs.tsx` `GradientRing`)
     that catches light on the edge of a **frosted / elevated** surface
     (composer panel, rail, active tab). White — or neutral in active states —
     at ≤10–55% alpha, frosted surfaces only, never solid / full-opacity, never
     on flat chrome.
   - No gradient/blurred "orb" backgrounds.

5. **English-only UI strings.** No Chinese (or other non-English) string
   literals in TSX. i18n, if ever added, starts from English source.

6. **Pointer cursor on anything clickable.** Tailwind v4's preflight resets
   `<button>` to `cursor: default`; a global base rule in `globals.css`
   restores `cursor: pointer` for buttons, `[role="button"]`,
   `[role="switch"]`, `label[for]`, and `a[href]` (and `not-allowed` for
   disabled). Don't sprinkle `cursor-pointer` per element — the global rule
   covers it.

## Component system

- **shadcn/ui**, style `radix-mira`, icon library **Tabler**
  (`@tabler/icons-react`) — matching `apps/web` so code can migrate over.
- Components in `components/ui/` are owned source. Restyling happens by
  editing them at the source (that is the point of shadcn), not by
  wrapping or overriding at call sites. The de-bordering of
  `card` / `input` / `textarea` / `select` / `tabs` is the precedent.
- Approved registry add-ons for the premium-AI feel (install via
  `npx shadcn add`): Magic UI, Aceternity UI, Origin UI, Kibo UI,
  react-bits, Motion Primitives, Vercel AI Elements. Anything pulled in
  must be re-checked against rules 2–4 (these kits love gradients and
  borders; strip them).
- Hardcoded Tailwind palette classes (`neutral-900`, hex colors) are
  web-isms — re-express with tokens when porting from `apps/web`.
  White-alpha _fills_ (`bg-white/[0.07]` etc.) are acceptable inside
  the frosted-chrome idiom where compositing over arbitrary content is
  the intent — fills only, never white-alpha rings/borders.

## Layout

- **One navigation everywhere: the floating 56px icon rail** (signed off
  2026-06-19; the earlier "context-split" with a labeled home sidebar was
  dropped — not enough top-level menus to warrant it). A pill fixed 24px from
  the viewport edge, vertically centered, grouped nav + detached settings;
  ported from the web `(fizzstudio)` rail (`app/_components/studio-sidebar.tsx`);
  content offsets `lg:pl-[104px]` (24 gap + 56 pill + 24 gap); hides below `lg`
  (mobile chrome TBD). **The home (`app/[locale]/page.tsx`) uses this same rail**
  — it just adds its own promo banner + auth-aware header (brand wordmark at the
  header's left edge, since the rail has no logo) + footer around the content.
- **Fill the shell.** The main content column FILLS its width — no page-level
  centered max-width. Only a focused text input (composer, chat) gets a centered
  cap (~1200px); galleries / grids / cards fill. (See `_pollo/DESIGN.md` §1.3, §4.)
- Genre conventions to follow as surfaces are built (2026 AI-studio
  research): prompt bar as the hero element with parameters in popovers /
  inline chips; create-and-browse on one surface (masonry feed of past
  generations under the composer, lightbox actions); model picker as a
  first-class control; schema-driven parameter forms (fal pattern);
  credit cost surfaced next to Generate before clicking; in-feed
  placeholder cards with progress for async jobs.

## Working agreements

- Tokens first: check the table above before inventing a color; new
  tokens require updating this file.
- When importing a tweakcn (or any) theme: the app is dark-only — take
  the values from the theme's `.dark` block into `:root` and discard its
  light block.
- Honest UI: features without a backing implementation render disabled
  with a "Coming soon" tooltip (see the rail), never as live-looking
  dead controls.
