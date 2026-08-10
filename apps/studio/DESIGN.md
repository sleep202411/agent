# FizzStudio Design System

FizzStudio is the standalone AI creative studio (image / video / audio
generation). It is extracted from the web app's `(fizzstudio)` surface and
will live on its own domain. It owns its own visual language: a dark,
monochrome, borderless "AI studio" interface in the imagine.art genre.

Read `../../DESIGN.md` first for shared brand rules. Where this file is
stricter than the shared rules, this file wins inside `apps/studio`.

This is the only design doc in this app and the single source of truth for
every studio design RULE. The home / app-shell IMPLEMENTATION detail — how the
frosted primitives, rim-light, mask-icon glyphs, sliding indicator, and composer
are built — is the "Home & app-shell (implementation)" section at the end.
Exact design-token VALUES live in `app/globals.css` `:root`, which is
authoritative: the tables below map tokens to roles, and where a value is shown,
`globals.css` wins if the two ever differ.

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
     `next-themes`. Preset data lives in `_pollo/theme.ts` (`THEMES`).

2. **Monochrome surfaces, zero chroma.** Every surface token is pure
   neutral (OKLCH chroma `0`). The approved scale:

   | Token        | Value                                   | Role                                 |
   | ------------ | --------------------------------------- | ------------------------------------ |
   | `background` | `oklch(0.17 0 0)`                       | page (the darkest tier)              |
   | `card`       | `oklch(0.215 0 0)`                      | panels, cards                        |
   | `popover`    | `oklch(0.235 0 0)`                      | overlays, menus, tooltips            |
   | `muted`      | `oklch(0.25 0 0)`                       | quiet fills                          |
   | `secondary`  | `oklch(0.26 0 0)`                       | secondary buttons                    |
   | `accent`     | `oklch(0.27 0 0)`                       | hover fills                          |
   | `primary`    | `oklch(0.5914 0.225 26.83)` (`#E52227`) | primary actions — brand red (rule 3) |
   | `border`     | `white / 8%`                            | hairlines (see rule 4)               |
   | `input`      | `white / 12%`                           | filled control surfaces              |

   These mirror `app/globals.css :root`, which is **authoritative** — if this
   table and the code ever differ, the code wins. (`primary` is the brand red
   per rule 3, not the white it carried before that reversal.)

   **Canvas elevation tiers.** Every authoring canvas uses the shared fixed
   screen-space dot field (`CanvasBackdrop`) over `oklch(0.18)`, one quiet tone
   step above the page. Its 20px dot spacing does not pan or scale with React
   Flow content. Floating panels then lift through tone, blur, and shadow.
   Layering on the canvas:
   canvas `0.18` → card `0.215` → floating composer `oklch(0.22)` →
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
     2026-06-12 against the imagine.art reference, restyled to the AI-glass
     language 2026-06-22): the cards are AI-glass surfaces — every plan card
     is a `FrostedPanel` + `GlassRim` (frosted fill + gradient rim-light),
     not a flat dark box. The base is monochrome and brand red `#E52227` is
     the single functional accent, kept sparse — lower tiers stay neutral
     glass (default white rim, white CTA, neutral checks), and brand red
     crowns only the one recommended (`marketing.badge === "Popular"`) tier.
     On that tier red appears as the card's subtle red gradient wash, a red
     `GlassRim`, the "POPULAR" ribbon, the discount chip, strikethrough
     price, included-credits count, check icons, and the glowing CTA; the
     billing-interval "-25%" savings chip is also brand red. Purchase-intent
     surfaces are the one place the monochrome rule yields to conversion, and
     the one sanctioned surface where brand red tints a card (an explicit
     rule-3 decision: the brand pushes the plan we recommend). The off-brand
     blue `#3a86ff` and yellow `#ffbe0b` are gone. These accents are
     hardcoded in `app/_components/subscription-dialog.tsx`, are NOT tokens,
     and must not leak into general chrome.

3. **Brand red IS `primary`** (decided 2026-08-04, reversing "red is not a
   token"). The FizzDragon red `#E52227` (`oklch(0.5914 0.225 26.83)`) is
   the value of `--primary`, with `--primary-foreground` white. It is the
   ONE chromatic token in the set; the brand's colour belongs on the thing
   you are meant to press.

   What the old rule was really protecting still stands, and is now the
   whole of it: **red never tints a SURFACE.** Every background token stays
   zero-chroma (rule 2). Red fills actions, never panels, rows, or fields.
   A red-washed UI remains rejected.

   Practical consequences, so this doesn't drift back:
   - `Button` `default` and `primary-cta` both fill with `bg-primary` and
     darken on hover (`color-mix … black 14%`), and now share the one 14px
     control radius (the full-round hero pill was retired 2026-08-04 — see
     "Radius & shape"). `primary-cta` is now the
     **"candy" hero treatment** — the imagine.art Generate button in brand red:
     a radial red fill, a soft red glow, a constant dark-red bevel lip, a top
     gloss and a slow diagonal sheen, with a real downward displacement on press
     (shape and height never change). It is the ONE most-important action on a
     view; `default` is every other primary action. The whole look is
     `.cta-candy` in `globals.css`, derived from `--primary`. Its glow is the
     one sanctioned red glow — it emphasizes the single hero press target, not
     the red depth-shadow on passive cards that the option-card note below still
     rejects.
     Neither hardcodes the hex any more — restyle the brand by editing the token.
   - `destructive` stays its own token. A solid red fill = the primary
     action; destructive is a translucent red TINT with red text. Do not
     give destructive a solid fill, or the two become indistinguishable.
   - Neutral/secondary actions (Cancel, Close, Back) use `ghost`,
     `secondary`, or `quiet` — not `default`. With a red primary, reaching
     for `default` on an incidental action shouts.

   Other systematic red uses, unchanged:
   - **Option-card selected state** (signed off 2026-07-20; full red fill
     was tried and rejected the same day as too heavy): in option/radio
     **card** groups (story create dialog format + frame cards first), the
     SELECTED card is marked by the **red rim-light treatment**: a red
     `GlassRim` (conic, 1.5px, peak alpha ≈0.55 in a bright arc at the
     top-left, easing to a legible floor of ≈0.22 around the rest — the
     floor must stay visible on every edge; dropping it near zero loses
     the selection boundary at the bottom-right and was rejected), a faint
     red wash (`bg-[#E52227]/[0.07]`, ≤10%), white title, brand-red icon. **No drop shadow / glow** — a red
     shadow on near-black reads as a smudge, not depth (rejected
     2026-07-20 along with the solid red fill). Never a solid red fill.
     Unselected cards stay neutral white-alpha. This applies to
     card-shaped single-choice groups only — not to tabs, list rows,
     toggles, or text selection, which keep the white/neutral active
     treatment.

   - **Required-field marker** (signed off 2026-07-20): a brand-red
     asterisk after the label of a required form field —
     `components/ui/required-mark.tsx` (`RequiredMark`). Mark every field
     whose value is mandatory in the submitted contract — including
     single-choice groups that ship with a default (decided 2026-07-20;
     the asterisk states "this value matters", not "this blocks submit").
     Purely optional fields stay unmarked. Pair with `aria-required` on
     the control. Labeled controls
     get it via `Field`'s `required` prop (`components/ui/field.tsx` — the
     standard label→control→error rhythm; use it instead of hand-rolled
     labels; `dense` for compact dialogs); use `RequiredMark` directly only
     in non-Field contexts (e.g. a fieldset legend).

   - **Agent failure details**: keep status metadata out of the main composer
     rhythm. FizzAgent exposes it through the compact header details action;
     its dialog uses `destructive`-token text only, with no red wash or rim.

   In all of these, red still never tints a passive surface. Generated
   imagery is the only other saturated content by default.

4. **Flat by default; boundaries only where they carry structure.** The
   shadcn border-everywhere look and card-everything layout are rejected.
   Page sections, empty states, and ordinary content groups stay transparent;
   do not wrap them in `FrostedPanel`, `bg-card`, or another filled rectangle.
   A real content card may use a tone step, while a structural shell boundary
   may use one quiet 1px separator instead of a shadow.
   - Inputs / textareas / selects: `border-transparent` + translucent fill
     (`bg-input/20`–`/30`).
   - Sidebar: exact `#0f0f0f` fill, one `white/8%` right separator, no outer
     shadow.
   - Empty / loading / zero-data states: content directly on the page canvas,
     with no card background, rim, border, or shadow.
   - Real content cards, controls, and pills may use restrained fills; do not
     add decorative `ring-*`.
   - Floating panels (dropdown / popover / dialog / tooltip / toast):
     `bg-popover` + shadow, de-ringed at the component source.
   - Other permitted boundaries: the **focus ring**
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

## Type scale

One neutral grotesque (`--font-sans`) carries the whole app; hierarchy comes
from **size, weight and tracking, never a second family**. `--font-mono` is for
machine data only. Abstracted from the imagine.art reference (display carries
negative tracking, labels are wide caps, data is mono) and disciplined to the
sizes this app actually uses.

| Role        | Size / line-height | Weight | Tracking           | Use                                                    |
| ----------- | ------------------ | ------ | ------------------ | ------------------------------------------------------ |
| **Display** | 52 / 56            | 700    | −0.02em            | hero tagline only — one per view                       |
| **Heading** | 32 / 40            | 600    | −0.01em            | page & major-section titles ("What's new")             |
| **Title**   | 20 / 28            | 600    | 0                  | card titles, dialog titles                             |
| **Body**    | 16 / 24            | 400    | 0                  | default running text                                   |
| **Small**   | 13 / 20            | 400    | 0                  | secondary / meta text, on `muted-foreground`           |
| **Label**   | 12 / 16            | 600    | 0.09em · UPPERCASE | eyebrows, section labels, chips                        |
| **Mono**    | 13                 | 400    | 0                  | data only — model ids, credit cost, dimensions, tokens |

- Negative tracking tightens Display/Heading; Labels earn the wide caps.
- **Mono is reserved for machine data** (`seedance-2.0`, `24 credits`,
  `1080p · 5s`) — never body copy.
- One Display per view, max. If two things want to be the biggest, one is wrong.

## Radius & shape

One control radius for everything you press or type into; larger radii for
larger surfaces; the full-round pill is reserved for segmented-control
**containers**, not buttons.

| Step          | Value                     | Use                                                          |
| ------------- | ------------------------- | ------------------------------------------------------------ |
| **panel**     | 24px                      | large frosted panels — composer, hero media card             |
| **sidebar**   | 0px outer / 12px selected | fixed collapsible navigation sidebar; selected row/control   |
| **card**      | 16px                      | cards, media thumbnails, promo tiles                         |
| **control**   | 14px (`rounded-xl`)       | **all** buttons, inputs, selects, chips, pills, icon buttons |
| **small**     | 8–10px (`rounded-md/lg`)  | dense control sizes (`xs`/`sm`), tiny chips                  |
| **segmented** | full-round                | segmented-control **containers** only (studio tabs)          |

**Buttons share the one 14px control radius** (decided 2026-08-04). The
full-round pill for the primary CTA was tried and retired: a hero action earns
emphasis from its fill (brand red), size and placement — not a different
silhouette from every other button. `primary-cta` keeps its name and its
brand-red focus ring and now carries the **candy hero treatment** (rule 3) at
that same 14px (`button.tsx` + `.cta-candy` in `globals.css`) — the difference
from `default` is treatment + intent, not shape or radius.
Full-round survives only on the tab segmented group (a container convention, not
a button) and genuinely circular affordances (avatars). This matches the
imagine.art reference, whose buttons hold a single ~12–14px radius throughout.

## Component system

- **shadcn/ui**, style `radix-mira`, icon library **Tabler**
  (`@tabler/icons-react`) — matching `apps/web` so code can migrate over.
- Components in `components/ui/` are owned source. Restyling happens by
  editing them at the source (that is the point of shadcn), not by
  wrapping or overriding at call sites. The de-bordering of
  `card` / `input` / `textarea` / `select` / `tabs` is the precedent.
  Per-component usage docs, where they exist, sit beside the source
  (e.g. `components/ui/button.md` — props, variants, sizes, examples).
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
- **Quiet icon button** (codified 2026-07-20 from the dialog-close redesign):
  the idiom for a standalone secondary icon action sitting on a borderless
  dark surface — dialog close, canvas-toolbar actions, card affordances.
  A rounded square with a **resting** white-alpha fill; a bare ghost icon
  with no resting fill reads as unanchored here and is rejected for these
  spots (`ghost` Button stays for inline/text-adjacent actions only).
  Normative recipe: hit area `size-7` (28px; toolbars may use up to
  `size-9`), radius `rounded-lg`–`rounded-xl`, resting
  `bg-white/[0.06] text-white/55`, hover `bg-white/[0.12] hover:text-white`,
  focus `focus-visible:ring-2 focus-visible:ring-white/35`, icon `size-3.5`
  – `size-4`, `transition`. Existing call sites drift across alpha
  `0.05`–`0.07` and text `55`–`66`; new code uses the normative values and
  old sites converge opportunistically when touched.

## Layout

- **One navigation everywhere: the fixed collapsible sidebar** (revised
  2026-08-10). It is flush with the left viewport edge and fills the full
  viewport height on the exact `#0f0f0f` shell surface. Expanded width is 224px
  with the brand, section labels, and labeled navigation rows; at viewport
  widths below 1024px it collapses automatically to 72px icon navigation.
  It is separated from content by one `white/8%` right border and never by a
  right-side drop shadow.
  Enabled navigation labels and section headings use pure white; disabled
  destinations remain muted so availability stays unambiguous.
  The expanded logo row is `logo flex-1 + collapse control`. In the collapsed
  state, the logo position becomes the expand control. Opening it on a narrow
  viewport creates a temporary expanded sidebar that closes from the outside
  scrim. The workspace switcher remains in its canonical header position
  between Upgrade and Account. Primary navigation sits at the top; Settings,
  Discord, mobile download, desktop download, and Help are grouped at the
  bottom. There is no floating outer pill or detached Settings puck. The product
  header and content occupy the remaining width and animate with the sidebar;
  fixed bottom composers retain a 16px working gap from its edge.
  **The home and app surfaces use this same shell.**
- **Fill the shell.** The main content column FILLS its width — no page-level
  centered max-width. Only a focused text input (composer, chat) gets a centered
  cap (~1200px); galleries / grids / cards fill. (Home build: see the last section.)
- **Do not account for the sidebar twice.** `StudioSidebarInset` already owns
  the complete horizontal offset. Page sections use only their normal 24px
  padding (32px on large viewports); they must not add legacy rail offsets such
  as `sm:pl-20` or `lg:pl-[120px]`.
- Genre conventions to follow as surfaces are built (2026 AI-studio
  research): prompt bar as the hero element with parameters in popovers /
  inline chips; create-and-browse on one surface (masonry feed of past
  generations under the composer, lightbox actions); model picker as a
  first-class control; schema-driven parameter forms (fal pattern);
  credit cost surfaced next to Generate before clicking; in-feed
  placeholder cards with progress for async jobs.

## Home & app-shell (implementation)

Implementation notes for the home (`app/[locale]/page.tsx`) and the shared
`_pollo/` system (`theme.ts`, `glyphs.tsx`, `composer.tsx`, `agent-studio.tsx`,
`project-studio.tsx`) — the imagine.art-genre surfaces, reverse-engineered from
pollo.ai and disciplined to the rules above. (This absorbs the former
`_pollo/DESIGN.md`, now deleted; these are notes, not new rules.)

- **Frosted primitives** back the canonical header pills, cards, and panels app-wide:
  `components/ui/frosted-panel.tsx` (`FrostedPanel` — translucent fill +
  `backdrop-blur` + `backdrop-saturate-150`; composer `blur(60)`, sidebar
  `blur(30)`) and `components/ui/glass-rim.tsx` (`GlassRim` / `GLASS_CONIC` —
  the masked rim-light of rule 4: conic white hairline on panels, radial
  corner-glow on the active tab, linear ring on the active sidebar item).
- **Mask-icon glyphs** (`glyphs.tsx` `G`): icons are a `mask-image` over a
  solid/gradient fill so they recolor by state (idle `white/65`, active =
  gradient); glyph set from pollo's `i-cus--pol-*`. Chrome may use Tabler
  outline icons (`stroke 1.7–1.8`).
- **Motion** (functional only): tabs use one element measured from the active
  button (`translateX` + `width`) at `.3s cubic-bezier(0,0,0.2,1)`. Sidebar
  selection changes tone without moving the navigation. Tab bodies crossfade
  via `@keyframes polloFade` (opacity + 3px rise, 300ms).
- **Composer**: a separate rail block (absolute, right-anchored, expands LEFT on
  hover so it never reflows) + a `FrostedPanel` — upload tiles + prompt over a
  toolbar (lead `+`, mode/model pills, grouped params with the duration glyph,
  settings) + the primary **Generate** (`primary-cta`, credit cost, optional
  discount badge).
- **Surfaces**: studio tabs = `Agent` / `Creative Studio` / `Project Studio`
  (pill group, sliding radial ring, gradient active label; Marketing/Commerce
  kept `hidden` until backable). Agent = frosted chat input + intent chips.
  Project = a Blank-Canvas tile + preset cards → `/<locale>/canvas`. Cards =
  thumbnail + label; badges `New` = accent pill, `% OFF` = accent text.
- **Accent preset** data (Mono/Red, rule 1) is in `_pollo/theme.ts` (`THEMES`);
  its surface values must mirror `globals.css :root` — never re-declare tokens.

## Composer drawer

The generation composer in the editor / canvas (the shot-frame editor, the
video / image composer) is a floating drawer, reverse-engineered from
imagine.art's video composer and disciplined to the rules above. Anatomy, top
to bottom:

- **Shell.** A `fixed` panel anchored beside the responsive sidebar
  (`left = sidebar + gap`),
  `top`/`bottom` inset so it floats; width responsive (~300px min,
  `max(20vw, 300px)` on wide screens); it opens/closes by animating its offset
  (300ms). It is a `FrostedPanel` (blur + saturate) carrying a `GlassRim` edge —
  **not** a 1px border (rule 4). Radius is asymmetric: 16px top, 24px bottom, so
  it reads as tucked under the top chrome. Layout is a flex column: a fixed
  header, a scrolling body, and a pinned footer.
- **Header = a mode dropdown**, not a fancy wheel. A row: glyph + the current
  mode + a modality tag (e.g. `Video`) + a chevron; clicking opens a real
  popover menu (`bg-popover` + shadow, de-ringed — rule 4) whose selected item
  carries a **brand-red check**. (imagine.art's animated "mode wheel" was
  evaluated and dropped — too much motion for the payoff; everything that looks
  interactive must actually be, so the header is a working menu, not a dead
  label.)
- **Body (scrolls).** Upload dropzones keep a **dashed** outline — a functional
  affordance, the one sanctioned outline here (rule 4). The **Prompt** is a
  border-transparent + translucent-fill field (rule 4); on focus the fill lifts
  and a **red rim-light** appears (imagine's active-purple, in our red). Inline
  `Elements` / `Enhancer` chips sit in the field; an active `Enhancer` reads
  brand-red. Parameters are neutral chips (`16:9 / 5s / 1080p`) with
  `tabular-nums` and a leading glyph.
- **Footer.** A full-width `primary-cta` (the candy Generate) pinned to the
  drawer's foot; credit cost / discount badge ride alongside it when present.

Built from the `components/ui/` primitives (`FrostedPanel`, `GlassRim`, the
`primary-cta` Button); the mode menu, chips, and prompt are all real controls.

## Working agreements

- Tokens first: check the table above before inventing a color; new
  tokens require updating this file.
- When importing a tweakcn (or any) theme: the app is dark-only — take
  the values from the theme's `.dark` block into `:root` and discard its
  light block.
- Honest UI: features without a backing implementation render disabled
  with a "Coming soon" tooltip (see the sidebar), never as live-looking
  dead controls.
