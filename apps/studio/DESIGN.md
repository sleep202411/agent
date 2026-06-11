# FizzStudio Design System

FizzStudio is the standalone AI creative studio (image / video / audio
generation). It is extracted from the web app's `(fizzstudio)` surface and
will live on its own domain. It owns its own visual language: a dark,
monochrome, borderless "AI studio" interface in the imagine.art genre.

Read `../../DESIGN.md` first for shared brand rules. Where this file is
stricter than the shared rules, this file wins inside `apps/studio`.

## Non-negotiables

1. **Dark-only.** There is no light theme and no theme switching.
   - The dark palette lives directly in `:root` in `app/globals.css`.
     There is no `.dark` token block.
   - `<html>` carries a permanent `dark` class (see `app/layout.tsx`) so
     `dark:` variants from third-party registry components still apply.
     App code must NOT write new `dark:` variants — they are dead weight here.
   - `color-scheme: dark` is declared on `:root`; `viewport.colorScheme`
     is `"dark"`. Never install `next-themes`.

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

   Two deliberate exceptions, both for **functional color that encodes data,
   not decoration**:
   - `destructive` keeps standard shadcn chroma — error semantics need color.
   - **Canvas connectors** (port handles, their labels, and the edges between
     them) are colored by data type: text/prompt = blue `#5b9dff`, image =
     amber `#e0a45c` (see `app/canvas/_components/port-colors.ts`). Edges are
     gradient-stroked between their two endpoint colors. This is the same
     category as chart colors — it carries meaning. Node surfaces stay
     monochrome; only the wires are colored.
     Neither exception is brand red, and neither may be used as a generic accent.

3. **Brand red is not a token.** The FizzDragon red `#E52227`
   (`oklch(0.5914 0.225 26.83)`) must never enter the global token set or
   tint neutral surfaces — a red-washed UI has been explicitly rejected.
   Red is reserved for rare, deliberate, case-by-case accents (e.g. a hero
   CTA), applied locally and only with an explicit decision. Generated
   imagery is the only saturated content by default.

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
   - No gradient/blurred "orb" backgrounds.

5. **English-only UI strings.** No Chinese (or other non-English) string
   literals in TSX. i18n, if ever added, starts from English source.

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

- **Left icon rail**: a floating 56px pill fixed 24px from the viewport
  edge, vertically centered, grouped nav + detached settings button —
  style ported from the web `(fizzstudio)` rail
  (`app/_components/studio-sidebar.tsx`). Content offsets with
  `lg:pl-[104px]` (24 gap + 56 pill + 24 gap); the rail hides below `lg`
  (mobile chrome TBD).
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
