# FizzStudio — Home & App-Shell Design Spec

The design language abstracted from the new homepage (`app/[locale]/home`) and
the shared `_pollo/` system (`theme.ts`, `glyphs.tsx`, `composer.tsx`,
`agent-studio.tsx`, `project-studio.tsx`). It is the **imagine.art-genre dark AI
studio**, reverse-engineered to pixel detail from pollo.ai and then disciplined
to our brand.

This file **extends** the binding `apps/studio/DESIGN.md`. Where it proposes a
change to a rule there, it is called out in **§7 Reconciliation** and is NOT yet
merged into the binding spec — those need sign-off first.

---

## 1. Principles

1. **Dark-only, monochrome surfaces.** Every surface is pure neutral (OKLCH
   chroma 0). Hue never tints a surface. (Inherits binding rules 1–2.)
2. **One accent, disciplined.** The single brand accent appears **only on
   primary action buttons** (Generate / Start for Free / Try Now / Send /
   Blank-Canvas +) and on commerce highlights (price / discount). It never tints
   a surface, an active-state fill, a headline, or chrome. Two presets only
   differ in what that accent is (see §2).
3. **Fill the shell; focus the inputs.** This is an app, not a landing page.
   Galleries, grids, cards and sections **fill** the main column. Only a
   focused text input (the composer, the chat box) gets a centered max-width
   (~1200px) for readability. Never reflex-wrap content in a centered column.
   See [[feedback_studio_fill_width]].
4. **Soft edges, not borders.** Separation comes from tone steps + shadow +
   backdrop blur, plus one sanctioned **frosted rim-light** (§3.2) — never a
   hard 1px outline or shadcn's border-everywhere.
5. **Motion is functional.** A single indicator _slides_ between targets;
   bodies _crossfade_ on swap. No decorative animation. 300ms `ease-out`.
6. **Honest UI · English-only strings · pointer cursors.** (Inherits binding
   rules 4–6.)

---

## 2. Accent presets (the theme)

The ONLY thing that varies between presets is the **accent**. Surfaces, active
states, radii, motion, layout are identical. This is **not** a light/dark theme
switch (still dark-only, no `next-themes`) — it is an accent preference.

| Preset    | Primary CTA button                       | Active states (tab ring, rail fill, headline, icons) | Price / discount |
| --------- | ---------------------------------------- | ---------------------------------------------------- | ---------------- | -------------------------------------------------------------- |
| **Mono**  | **white** `oklch(0.922 0 0)` (dark text) | neutral white                                        | brand red        |
| **Red**   | **brand red** `#E52227` (white text)     | neutral white (same as Mono)                         | brand red        |
| ~~Pollo~~ | pink `#FF3466`                           | pink                                                 | pink             | _reference only — the pollo.ai original; not a shipped option_ |

So **Mono and Red are one design that differs only in CTA button color.** Per
the latest decision, red is reserved for primary action buttons; everything
else stays neutral.

**Surface tokens** (zero-chroma, shared by all presets; aligns with binding
rule 2's elevation ladder):

| Slot        | Value                     | Role                           |
| ----------- | ------------------------- | ------------------------------ |
| `pageBg`    | `oklch(0.13 0 0)`         | page                           |
| `panelBg`   | `oklch(0.205 0 0 / 0.72)` | frosted composer / chat panel  |
| `railBg`    | `oklch(0.24 0 0 / 0.92)`  | modality rail                  |
| `popoverBg` | `oklch(0.19 0 0)`         | menus / popovers               |
| `surface`   | `oklch(0.205 0 0)`        | cards, tool thumbs, model rows |

**Accent slots** (the only colored values; `genBg/genText/genShadow` = the CTA,
`price` = commerce highlight). Mono `genBg`=white, Red `genBg`=`#E52227`. All
active-state slots (`accentText`, `word`, `tabRing`, `railFill`, `railRing`,
glows) are **neutral white** in both shipped presets.

Source of truth: `_pollo/theme.ts` (`THEMES`, `Theme` type).

---

## 3. Design language (visual vocabulary)

### 3.1 Frosted panels

Translucent neutral fill + `backdrop-blur` + `backdrop-saturate-150`. Composer
panel `blur(60)`, rail `blur(30)`. This is the "floating glass over content"
idiom — the reason surfaces are translucent (`/0.72`, `/0.92`) not solid.

### 3.2 Frosted rim-light (the gradient edge) — _sanctioned exception to "no borders"_

Elevated frosted surfaces (composer panel, rail, active tab) carry a **soft,
low-contrast gradient hairline** that catches light on the edge — a rim-light,
not an outline. Implemented as an inset overlay masked to a 0.5–1.5px ring:
`background:<gradient>; padding:<ring>; mask-composite: exclude` (see
`GradientRing`). Gradients: panels/rail = **conic** `rgba(255,255,255,0.10)`
hairline; active tab = **radial** corner-glow; active rail item = **linear**
ring. **Constraints:** white (or, in active states, neutral) at ≤10–55% alpha,
on frosted/elevated surfaces only, never a solid or full-opacity border.

> **This is the signature "AI glass" look — a flat `ring-1` hairline is NOT it.**
> §3.1 + §3.2 are codified as **app-wide shared primitives** so every surface
> gets the glass, not just the home: `components/ui/glass-rim.tsx` (`GlassRim` +
> `GLASS_CONIC`) is the masked conic rim-light; `components/ui/frosted-panel.tsx`
> (`FrostedPanel`) is the frosted body (blur+saturate) + rim. They back the
> header pills (credits / workspace / locale / account), cards, and panels.

### 3.3 Mask-icon glyphs

Icons render as a CSS `mask-image` over a solid or gradient **fill**, so they
recolor by state without swapping assets: idle `rgba(255,255,255,0.65)`, active
= gradient. Glyph set lifted from pollo's `i-cus--pol-*` (see `glyphs.tsx` `G`).
App chrome may use Tabler outline icons (`stroke 1.7–1.8`).

### 3.4 Sliding indicator

An active selection is **one element that moves**, not a per-item restyle:

- Modality rail: indicator `translateY(index·40px)`.
- Studio tabs: indicator measured from the active button (`offsetLeft/Width`),
  `translateX`+`width`.
  Both `transition .3s cubic-bezier(0,0,0.2,1)`.

### 3.5 Crossfade

Tab-body swaps animate in via `@keyframes polloFade` (opacity + 3px rise, 300ms).

### 3.6 Radii & shape

panel `24` · rail `18` · control/pill `14` · small `lg/8` · **primary CTA + tabs
= full-round**.

---

## 4. Layout / app shell

- **Left nav = the shared `StudioSidebar`** — the app's 56px **icon rail**
  (Home / Canvas / Images / Video / Audio / Settings), `fixed`, vertically
  centered, `lg+` only. The home reuses it rather than a bespoke labeled
  sidebar — we don't have pollo's ~15 menu items, so the home shares the exact
  rail the rest of the studio uses. The brand wordmark sits at the header's
  left edge (the rail carries no logo). Content offsets `lg:pl-[104px]`.
- **Top promo banner** (full-width) + **top-right header**, auth-aware:
  logged-out = `Pricing` ghost link + a single themed `Login` CTA (one button,
  accent color); logged-in = workspace switcher + compute-credits badge + a
  themed `Upgrade` (membership) CTA + the account menu. Reuses the real
  `WorkspaceSwitcher` / `CreditsBadge` / `AccountMenu` / `SubscriptionDialog`.
- **Main column fills** the remaining width; no page-level max-width cap.
- **Hero** = studio tabs + a per-tab body; headline is a static tagline.
- **Content rows that never wrap** scroll horizontally with ←/→ controls
  (Recent Projects); **grids** (Models, Explore) fill and add columns at wider
  breakpoints.

---

## 5. Component anatomy

- **Studio tabs** — `Agent` (default, chat-first) · `Creative Studio`
  (generation composer) · `Project Studio` (canvas/project entry). Pill group +
  sliding radial accent ring + gradient active label. Marketing/Commerce kept
  in data as `hidden` (re-enable when backable).
- **Creative composer** — a **separate** rail block (absolute, right-anchored,
  expands LEFT on hover so the composer never reflows) + frosted panel. Panel =
  upload tiles + prompt over a toolbar (lead `+`, mode/model pills, grouped
  params with the duration glyph, settings) + primary **Generate** (accent,
  credit cost, optional discount badge).
- **Agent** — frosted chat input (attach + accent Send) + intent-suggestion
  chips that route to modules (routing = backend follow-up).
- **Project** — Blank-Canvas tile + real workflow-preset cards → `/<locale>/canvas`.
- **Cards** — thumbnail + label below. Badges: `New` = accent pill, `% OFF` =
  accent text, others neutral.

---

## 6. Status

Bespoke inline-Tailwind implementation in `_pollo/` (shared system) + `_home/`
(home-only chrome + sections) (not yet built on our shadcn components). Content
uses pollo's real CDN imagery + sample presets as placeholders. Not wired to
`/aurora/ai` or the local project store. **This IS the live homepage** at `/`
(`app/[locale]/page.tsx`); the old `(studio)/page.tsx` and its components were
removed. A Mono/Red accent toggle remains bottom-right as a temporary preview
affordance until the accent is finalized.

---

## 7. Reconciliation with the binding `DESIGN.md` (needs sign-off)

| #   | Binding rule                                                                                            | This system                                                                                     | Proposed resolution                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Rule 1: "no theme switching"                                                                            | Mono/Red **accent** presets, user-selectable                                                    | Keep dark-only + no `next-themes`; permit an **accent preset** choice (CTA color only). Clarify rule 1: the ban is on light/dark switching, not an accent preference.                                                                                                                                                |
| 2   | Rule 3: red is "rare, deliberate, case-by-case (e.g. a hero CTA); never a token; never tints a surface" | Red preset puts brand red on **all** primary CTAs systematically                                | Codify the **Red accent preset** as a sanctioned, systematic CTA use — still never a neutral token, never tinting a surface. (Rule 3's own example is "a hero CTA", so this is an extension, not a reversal.)                                                                                                        |
| 3   | **Rule 4: "No borders. Anywhere,"** incl. hairlines on panels & decorative `ring-*`                     | Frosted rim-light gradient edges on composer/rail/active-tab (§3.2)                             | **DECISION NEEDED.** Either (a) carve out the rim-light as a sanctioned soft-edge technique (low-alpha, frosted surfaces only, never a hard outline), or (b) drop the gradient edges and rely on tone+blur+shadow alone. I lean (a) — it's the premium edge you liked — but this is your firmest rule, so your call. |
| 4   | Layout: "left **56px icon** rail" (ported from web)                                                     | ~~Labeled ~212px sidebar (pollo genre)~~ → **dropped**; home now uses the shared 56px icon rail | **No conflict.** The home adopts the binding spec's 56px icon rail (`StudioSidebar`) verbatim — we don't have enough top-level menus to justify a labeled sidebar. The bespoke labeled sidebar was removed.                                                                                                          |
| 5   | Component system: shadcn `radix-mira` + Tabler                                                          | Bespoke inline (gradient-ring/glyph helpers), Tabler for chrome                                 | On integration, re-express as restyled shadcn components; the `_pollo` helpers stay for the signature bits (glyphs, rim-light, sliding indicator).                                                                                                                                                                   |

**RESOLVED 2026-06-19** (signed off, folded into the binding `apps/studio/DESIGN.md`):

- #1 — accent-preset framing accepted (dark-only stands; Mono/Red accent choice allowed, no `next-themes`).
- #2 — Red CTA preset codified as the systematic sanctioned red use (CTA fill only, never a token/surface).
- #3 — **(a)** the frosted rim-light is a sanctioned soft-edge exception to rule 4 (low-alpha, frosted surfaces only, never a hard outline).
- #4 — **unified on the 56px icon rail**: the home uses the shared `StudioSidebar`, same as every other surface (the labeled-sidebar idea was dropped 2026-06-19 — not enough top-level menus to warrant it). Brand wordmark moves to the header's left edge.
- #5 — shadcn integration remains a later step; `_pollo` helpers stay for the signature bits.
