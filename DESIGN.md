---
version: alpha
name: FizzDragon
description: "A confident dark creator-studio platform — solid black canvas as the marketing ground (Framer-inspired), with floating liquid-glass surfaces for application chrome (dialogs, nav, AI panels). One signal red (#E52227) is the only brand-fill colour; everything else is monochrome with a seven-tone persona palette reserved for crew-role badges. Display type leans into negative tracking; body sticks to Inter Variable. Layout language is two-mode: marketing surfaces stack solid sections with one hero band per page, while in-app workspaces use three-pane composition (nav · canvas · context panel) with glass overlays."

colors:
  # Brand — single signal red. Used as primary CTA fill, focus ring,
  # selected state, destructive accent. Never as a section background.
  primary: "#E52227"
  on-primary: "#ffffff"
  primary-soft: "rgba(229,34,39,0.10)"
  primary-ring: "rgba(229,34,39,0.40)"

  # Surface — solid dark stack (canvas → surface-1 → surface-2).
  # This is the "marketing" elevation system: hierarchy via lightness
  # step-up, not via shadow.
  canvas: "#0a0a0b"
  surface-1: "#141416"
  surface-2: "#1c1c1f"
  hairline: "#262629"
  hairline-soft: "#1a1a1c"

  # Glass — translucent surfaces for floating UI (dialogs, top nav
  # when scrolled, AI panel, floating toolbars, tooltips). These ride
  # ON TOP of the canvas; they are NOT a replacement for surface-1/2.
  glass-1: "rgba(255,255,255,0.04)"
  glass-2: "rgba(255,255,255,0.06)"
  glass-3: "rgba(255,255,255,0.08)"
  glass-border: "rgba(255,255,255,0.08)"
  glass-highlight: "rgba(255,255,255,0.06)"

  # Ink — text hierarchy is binary on dark.
  ink: "#ffffff"
  ink-muted: "#9ca0a8"
  ink-subtle: "#6b6f78"

  # Persona — seven-tone accent system reserved for crew roles in
  # storyboard / chat / pill rails. NEVER use these as primary brand
  # colour. Source of truth: `src/lib/assistant/personas.ts`.
  persona-violet: "#8b5cf6" # scriptwriter
  persona-amber: "#f59e0b" # characterDesigner
  persona-teal: "#14b8a6" # sceneDesigner
  persona-rose: "#f43f5e" # artDirector
  persona-sky: "#38bdf8" # storyboardDesigner
  persona-lime: "#84cc16" # episodePlanner
  persona-orange: "#f97316" # propDesigner

  # Semantic
  success: "#22c55e"
  warning: "#f59e0b"
  destructive: "{colors.primary}"

typography:
  display-xl:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui"
    fontSize: 64px
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: -2.5px
  display-lg:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui"
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.0
    letterSpacing: -1.8px
  display-md:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -1.0px
  display-sm:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.6px
  headline:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.3px
  body-lg:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: -0.15px
  body:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: -0.12px
  body-sm:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: -0.1px
  caption:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: -0.08px
  micro:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0
    textTransform: uppercase
  button:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: -0.1px
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.5

rounded:
  none: 0
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 24px
  pill: 999px
  full: 9999px

spacing:
  hair: 1px
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 80px

blur:
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px

components:
  # ─── Marketing surfaces (solid) ──────────────────────
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    padding: 10px 16px
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    padding: 10px 16px
  button-outline:
    backgroundColor: transparent
    border: "1px solid {colors.hairline}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    padding: 10px 16px
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.ink-muted}"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    padding: 8px 12px

  # ─── Floating surfaces (liquid glass) ────────────────
  glass-panel:
    backgroundColor: "{colors.glass-1}"
    backdropBlur: "{blur.lg}"
    border: "1px solid {colors.glass-border}"
    boxShadow: "0 8px 32px 0 rgba(0,0,0,0.37), inset 0 1px 0 0 {colors.glass-highlight}"
    rounded: "{rounded.xl}"
  glass-dialog:
    backgroundColor: "{colors.glass-2}"
    backdropBlur: "{blur.xl}"
    border: "1px solid {colors.glass-border}"
    boxShadow: "0 24px 80px 0 rgba(0,0,0,0.55), inset 0 1px 0 0 {colors.glass-highlight}"
    rounded: "{rounded.xl}"
  glass-nav:
    backgroundColor: "{colors.glass-1}"
    backdropBlur: "{blur.lg}"
    borderBottom: "1px solid {colors.glass-border}"
    height: 56px

  # ─── Content cards ───────────────────────────────────
  card:
    backgroundColor: "{colors.surface-1}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.xl}"
    padding: 16px
  card-floating:
    backgroundColor: "{colors.glass-1}"
    backdropBlur: "{blur.md}"
    border: "1px solid {colors.glass-border}"
    rounded: "{rounded.xl}"
    padding: 16px

  # ─── Form ────────────────────────────────────────────
  text-input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.hairline}"
    rounded: "{rounded.md}"
    padding: 10px 12px
  text-input-focused:
    backgroundColor: "{colors.surface-1}"
    border: "1px solid {colors.primary-ring}"
    boxShadow: "0 0 0 3px {colors.primary-soft}"
    rounded: "{rounded.md}"

  # ─── Crew / Persona ──────────────────────────────────
  persona-pill:
    backgroundColor: "rgba(persona,0.10)"
    border: "1px solid rgba(persona,0.30)"
    textColor: "var(--persona-fg)"
    rounded: "{rounded.pill}"
    padding: 4px 10px
---

## Overview

FizzDragon's design system has **two visual modes** that coexist on the
same dark canvas:

1. **Marketing mode** — solid surfaces, Framer-style poster typography,
   single signal red, persona-coloured spotlight tiles. Used on the
   public-facing plaza pages: `/`, `/news`, `/ips`, `/creators`,
   `/crews`, `/art-studio`, `/about`. Hero band is the page anchor.
2. **Application mode** — liquid-glass overlays on top of the marketing
   canvas. Used for **floating** UI inside the workspace: dialogs, top
   nav when scrolled, AI assistant panel, floating toolbars, popovers,
   command menus, tooltips. Glass surfaces NEVER replace primary content
   panes — those stay solid (`surface-1` / `surface-2`).

The split is not theme-based or route-based — it's **surface-role-based**.
A `/projects/[id]/...` workspace page uses BOTH modes: solid sidebar +
solid main canvas + glass top-nav-when-scrolled + glass AI panel.

Surface decision rule (when you're not sure):

| The thing you're styling …                                 | Use                                   |
| ---------------------------------------------------------- | ------------------------------------- |
| A persistent area that holds primary content               | **Solid** (`surface-1` / `surface-2`) |
| A floating layer above content (dialog, dropdown, toolbar) | **Glass**                             |
| A static section on a marketing/plaza page                 | **Solid**                             |
| A scroll-tracked floating chrome (nav, breadcrumb bar)     | **Glass**                             |
| A persona-coloured highlight (pill, badge, focus ring)     | **Persona token**                     |

---

## Colours

### Brand

**Primary Red** `{colors.primary}` (`#E52227`)

- The single signal colour. Primary CTA fill, destructive accent,
  selected/focused indicator.
- **Never** used as a section background. **Never** more than one red
  surface per viewport region.
- Pairs with `{colors.on-primary}` white text only.

`{colors.primary-soft}` and `{colors.primary-ring}` exist for focus rings
and pressed states — these are **derivatives**, not separate brand colours.

### Surface — Solid

The solid surface stack expresses elevation through colour step-up, the
Framer way. No shadow needed at this layer.

| Token                              | Use                                                   |
| ---------------------------------- | ----------------------------------------------------- |
| `{colors.canvas}` `#0a0a0b`        | Page background. Hero, section ground, footer.        |
| `{colors.surface-1}` `#141416`     | Cards, sidebars, secondary buttons, input fields.     |
| `{colors.surface-2}` `#1c1c1f`     | Featured cards, hovered surfaces, selected list rows. |
| `{colors.hairline}` `#262629`      | 1px borders on inputs, panel separators.              |
| `{colors.hairline-soft}` `#1a1a1c` | Subtler dividers between FAQ rows / list items.       |

### Surface — Glass

For floating layers above content. Always paired with `backdrop-filter:
blur(...)` to make the layer behind read through.

| Token                                               | Use                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `{colors.glass-1}` `rgba(255,255,255,0.04)`         | Light glass — tooltips, hover overlays, scrolled top nav.               |
| `{colors.glass-2}` `rgba(255,255,255,0.06)`         | Medium glass — dialogs, popovers, dropdown menus.                       |
| `{colors.glass-3}` `rgba(255,255,255,0.08)`         | Heavy glass — modal sheets, the AI panel header.                        |
| `{colors.glass-border}` `rgba(255,255,255,0.08)`    | 1px ring around any glass surface — required, this is the "edge light". |
| `{colors.glass-highlight}` `rgba(255,255,255,0.06)` | Inset top 1px — simulates the refractive top edge on glass.             |

**Hard rule for glass:** every glass surface MUST carry three things —
the translucent fill, the `backdrop-blur`, AND the `glass-border` ring +
top inset highlight. Drop any one and it stops reading as glass; it
reads as "translucent rectangle with bug".

### Ink (text)

| Token                           | Use                                          |
| ------------------------------- | -------------------------------------------- |
| `{colors.ink}` white            | Display, headline, primary body.             |
| `{colors.ink-muted}` `#9ca0a8`  | Secondary body, meta info, deselected.       |
| `{colors.ink-subtle}` `#6b6f78` | Tertiary — captions, footnotes, placeholder. |

Hierarchy is carried by `ink → ink-muted → ink-subtle`, not by weight
ramps. Display sits at weight 600-700, body at 400, caption at 500 — and
that's the entire ramp.

### Persona — Seven-tone accent system

Reserved for **crew role attribution** across the storyboard editor,
AI assistant pills, and chat bubble decoration. NEVER use these as the
primary brand colour.

Source of truth: `apps/web/src/lib/assistant/personas.ts`.

| Token                     | Role                | Reference                     |
| ------------------------- | ------------------- | ----------------------------- |
| `{colors.persona-violet}` | Scriptwriter        | `personas.scriptwriter`       |
| `{colors.persona-amber}`  | Character Designer  | `personas.characterDesigner`  |
| `{colors.persona-teal}`   | Scene Designer      | `personas.sceneDesigner`      |
| `{colors.persona-rose}`   | Art Director        | `personas.artDirector`        |
| `{colors.persona-sky}`    | Storyboard Designer | `personas.storyboardDesigner` |
| `{colors.persona-lime}`   | Episode Planner     | `personas.episodePlanner`     |
| `{colors.persona-orange}` | Prop Designer       | `personas.propDesigner`       |

Each is exposed as a triple — fill (10% alpha), border (30% alpha),
text (full saturation). See `PERSONA_TONE_CLASSES` in the source file.

### Semantic

| Token                                                | Use                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `{colors.success}` `#22c55e`                         | Success toast, completed checkmark, "Visible in Market" chip.                         |
| `{colors.warning}` `#f59e0b`                         | Warning toast, recruiting/half-filled progress, Unpublish action.                     |
| `{colors.destructive}` aliased to `{colors.primary}` | Error toast, failed card border, delete button. The brand red IS the destructive red. |

---

## Typography

**Single font family**: Inter Variable. No commissioned display face —
hierarchy is carried by size + letter-spacing tightening, not by switching
typefaces.

### Hierarchy

| Token                     | Size | Weight | Tracking      | Use                                        |
| ------------------------- | ---- | ------ | ------------- | ------------------------------------------ |
| `{typography.display-xl}` | 64px | 700    | -2.5px        | Page hero (`/`, `/art-studio`)             |
| `{typography.display-lg}` | 48px | 700    | -1.8px        | Plaza hero (`/ips`, `/creators`, `/crews`) |
| `{typography.display-md}` | 32px | 600    | -1.0px        | Section headline, dialog hero title        |
| `{typography.display-sm}` | 24px | 600    | -0.6px        | Card group headline                        |
| `{typography.headline}`   | 18px | 600    | -0.3px        | Card title, tab title                      |
| `{typography.body-lg}`    | 16px | 400    | -0.15px       | Hero subhead, lead paragraphs              |
| `{typography.body}`       | 14px | 400    | -0.12px       | Default body                               |
| `{typography.body-sm}`    | 13px | 400    | -0.1px        | Dense rows, secondary body                 |
| `{typography.caption}`    | 12px | 500    | -0.08px       | Meta info, footnotes                       |
| `{typography.micro}`      | 11px | 500    | 0 / UPPERCASE | Eyebrow, status badge, section label       |
| `{typography.button}`     | 13px | 500    | -0.1px        | All pill / rectangular buttons             |
| `{typography.mono}`       | 11px | 400    | 0             | Code, error payloads, IDs                  |

### Principles

- **Letter-spacing scales with size.** Display at 64px gets -2.5px (~4%
  of size); body at 14px gets -0.12px (~1%). The compression is what
  makes large type read as "poster", not as "huge web body".
- **Weight stays in three bands.** 700 for display, 600 for headline /
  display-sm, 500 for buttons + meta, 400 for body. Don't reach for 800
  or 300 — the brand voice is in the size + tracking, not in weight.
- **Inter Variable, no character variants required.** Framer pushes hard
  on `cv01/cv05/cv09/cv11` and the variants are part of the Framer voice;
  FizzDragon ships Inter at default settings — easier to load, easier to
  match across SSR.
- **Tight line-heights everywhere.** Body at 1.5, display at 0.95-1.2 —
  this is tighter than typical SaaS body type (1.6+) on purpose.

---

## Spacing & Layout

### Base unit

**4px** (standard 4-pt grid). Avoid magic numbers between tokens.

### Tokens

| Token               | Value | Use                                     |
| ------------------- | ----- | --------------------------------------- |
| `{spacing.hair}`    | 1px   | Border, divider                         |
| `{spacing.xxs}`     | 4px   | Inline gap, badge padding               |
| `{spacing.xs}`      | 8px   | Compact gap, small button padding       |
| `{spacing.sm}`      | 12px  | Default inline gap                      |
| `{spacing.md}`      | 16px  | Card padding, dialog body padding       |
| `{spacing.lg}`      | 24px  | Card grid gap, section internal padding |
| `{spacing.xl}`      | 32px  | Section padding, dialog hero padding    |
| `{spacing.xxl}`     | 48px  | Major section break                     |
| `{spacing.section}` | 80px  | Plaza-page hero / between-band spacing  |

### Container widths

| Width                        | Use                                                 |
| ---------------------------- | --------------------------------------------------- |
| `max-w-6xl` (72rem / 1152px) | Profile page, account settings                      |
| `max-w-7xl` (80rem / 1280px) | Plaza pages (default)                               |
| `max-w-screen-xl` (1280px)   | Workspace top-level — bumps to full-bleed in editor |
| Full bleed                   | Storyboard editor canvas, AI panel, dialog content  |

### Whitespace philosophy

On marketing surfaces: the dark canvas IS the whitespace. Sections
separate by mode change (band of cards → band with hero spotlight → band
of cards), not by white space alone.

In workspaces: density is the default. Long lists, dense panels, small
type. Whitespace exists to separate functional regions (sidebar / canvas
/ panel), not to "let things breathe".

---

## Elevation & Depth

Two systems, used together:

### Solid surface lift (marketing + persistent content)

| Level | Treatment                                                       | Use                                          |
| ----- | --------------------------------------------------------------- | -------------------------------------------- |
| 0     | `{colors.canvas}`                                               | Page ground                                  |
| 1     | `{colors.surface-1}`                                            | Card, sidebar, input                         |
| 2     | `{colors.surface-2}`                                            | Featured card, hovered surface, selected row |
| Focus | `{colors.primary-ring}` 1px + `{colors.primary-soft}` 3px outer | Focused input, selected pill                 |

No shadow at this layer. Hierarchy is read from lightness step-up.

### Liquid glass (floating UI)

| Level            | Treatment                                                                          | Use                                      |
| ---------------- | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| 1 (light glass)  | `glass-1` + `backdrop-blur-lg` + `glass-border` + inset top highlight              | Tooltip, hover preview, scrolled top nav |
| 2 (medium glass) | `glass-2` + `backdrop-blur-xl` + `glass-border` + inset top highlight + soft drop  | Dialog, dropdown menu, popover           |
| 3 (heavy glass)  | `glass-3` + `backdrop-blur-2xl` + `glass-border` + inset top highlight + deep drop | Modal sheet, AI panel sticky header      |

**Required cocktail for glass** (drop any one and it stops reading):

```css
background: var(--glass-2); /* 6% white tint */
backdrop-filter: blur(var(--blur-xl)); /* 32px frost */
border: 1px solid var(--glass-border); /* 8% white edge */
box-shadow:
  0 24px 80px 0 rgba(0, 0, 0, 0.55),
  /* depth drop */ inset 0 1px 0 0 var(--glass-highlight); /* top refractive edge */
```

In Tailwind:

```tsx
className="
  bg-white/6 backdrop-blur-2xl
  ring-1 ring-white/8
  shadow-[0_24px_80px_0_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)]
"
```

---

## Shapes (border radius)

| Token            | Value  | Use                                   |
| ---------------- | ------ | ------------------------------------- |
| `{rounded.xs}`   | 4px    | Tag, chip, badge                      |
| `{rounded.sm}`   | 6px    | Inline pill, small action             |
| `{rounded.md}`   | 8px    | Input, list row                       |
| `{rounded.lg}`   | 12px   | Button (all of them), small card      |
| `{rounded.xl}`   | 16px   | Card, dialog, glass panel             |
| `{rounded.xxl}`  | 24px   | Hero card, large illustrated panel    |
| `{rounded.pill}` | 999px  | Persona pill, role chip, status badge |
| `{rounded.full}` | 9999px | Avatar, circular icon button          |

**Rule:** buttons are `rounded.lg` (12px squared corners with subtle softening).
Pills (`rounded.pill`) are reserved for **status / persona / tag** — never
for primary actions. This is different from Framer (which uses pills
everywhere) — FizzDragon's primary CTAs feel more "app button" than
"marketing pill".

---

## Component patterns

### Create-entity dialog (canonical)

**Reference**: `apps/web/app/(site)/ips/_components/create-ip-dialog.tsx`

Every "create entity" dialog (Create IP, Create Crew, Create Episode, …)
must match this skeleton:

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
    <DialogHero
      src={HERO_IMG_URL}
      eyebrow="STORYOS / SECTION"
      title={t("dialogTitle")}
      description={t("dialogSubtitle")}
    />
    <DialogBody>
      <FieldGroup>
        <Field>
          <FieldLabel required>{t("fieldX")}</FieldLabel>
          <Input value={…} onChange={…} placeholder={…} maxLength={…} />
        </Field>
      </FieldGroup>
    </DialogBody>
    <DialogFooter>
      <Button variant="outline" color="muted" onClick={…} disabled={submitting}>
        {tc("cancel")}
      </Button>
      <Button onClick={handleCreate} disabled={!canSubmit}>
        {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
        {submitting ? t("submitting") : t("submit")}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Hard rules:**

- `<DialogHero>` carries the **eyebrow + title + description** triple.
  No bare `<DialogHeader>` — the visual identity comes from the hero
  image bleeding to the dialog edge.
- `sm:max-w-lg` (32rem). Wider dialogs feel like settings sheets; this
  is a focused entry form.
- Dialog body uses `<FieldGroup>` + `<Field>` — never raw labeled
  `<input>` blocks. See "Form fields" below.
- Footer has Cancel left, Primary right. Cancel is `variant="outline"
color="muted"`. Primary is the default button (red).

### Edit-entity dialog (canonical)

**Reference**: `apps/web/app/(site)/crews/_components/create-crew-dialog.tsx`

The same dialog component handles **both create and edit** when given an
optional `initial` prop. Switches:

- Hero title / subtitle → edit-mode strings
- Submit calls `useUpdate*` instead of `useCreate*`
- Toast and i18n keys swap (`createSuccess` ↔ `updateSuccess`)
- `useEffect` prefills fields from `initial` on open, clears on close

Don't fork into two separate dialog components. One dialog, one prop.

### Form fields

**Reference**: `apps/web/components/ui/field.tsx`

```tsx
<FieldGroup>
  <Field>
    <FieldLabel required>{t("name")}</FieldLabel>
    <Input value={…} onChange={…} placeholder={…} maxLength={…} />
  </Field>
  <Field>
    <FieldLabel>{t("description")}</FieldLabel>
    <Textarea value={…} onChange={…} rows={3} maxLength={500} />
  </Field>
</FieldGroup>
```

- **`required` star is rendered by `<FieldLabel required>`** — don't
  hand-roll asterisks.
- Always set `maxLength` on inputs. The platform's backend storage
  contract assumes upper bounds (60 char name, 500 char description,
  1000 char prompt). Match those caps.
- Always set `placeholder` on the i18n side, not as a hardcoded prop —
  it's user-facing copy.
- For optional text areas, also set a sensible `rows` (3 for short
  descriptions, 6 for prompts) so the field doesn't collapse on first
  paint.

### Error toasts

**Reference**: `apps/web/app/(site)/crews/_components/create-crew-dialog.tsx#handleSubmit`

Mutation `onError` should surface the raw backend response when the
error is an `ApiRequestError`:

```ts
onError: (err) => {
  if (err instanceof ApiRequestError) {
    const detail = err.responseBody?.slice(0, 800) || err.message;
    toast.error(`HTTP ${err.status}`, {
      description: detail,
      duration: 10000,
    });
  } else {
    const msg = err instanceof Error ? err.message : "";
    toast.error(msg || t("createFailed"));
  }
};
```

**Why:** Java backend often returns a JSON envelope `{code, msg, data}`
in HTTP 200. The `ApiRequestError` carries the raw body so we can show
the actual `msg`. Falling back to a generic "Create failed" toast loses
the actionable detail. Mirror this pattern in every mutation.

For **generation tasks** specifically (image / video / audio / fusion /
lipsync), the toast is auto-fired by a Redux listener middleware
(`apps/web/src/store/task-failure-toast.ts`). Don't add a second toast
inside the queue — it'll double-fire.

### File uploads

**Reference**: `apps/web/app/(site)/crews/_components/create-crew-dialog.tsx#handleBannerFile`

```tsx
const [uploading, setUploading] = useState(false);
const inputRef = useRef<HTMLInputElement>(null);

const handleFile = async (file: File) => {
  if (!file.type.startsWith("image/")) {
    toast.error(t("imageOnly"));
    return;
  }
  setUploading(true);
  try {
    const path = await uploadAvatar(file);
    if (typeof path !== "string" || path.length === 0) {
      throw new Error("upload returned empty path");
    }
    setUploadedPath(path);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    toast.error(msg || t("uploadFailed"));
  } finally {
    setUploading(false);
  }
};
```

Hidden `<input type="file">` + `inputRef.current?.click()` from a styled
button — never a visible file picker. Toast on success is usually
unnecessary; the visible preview switch is feedback enough.

### Failure card (generation surfaces)

**Reference**: `apps/web/app/projects/_components/storyboard/ai-generator/failed-result-card.tsx`

Every AI generation surface (image / video / fusion / lipsync) renders
failed tasks through `<FailedResultCard>`:

```tsx
<FailedResultCard
  error={item.error}
  className="aspect-square" // or "aspect-video", "h-24", etc.
  onRetry={() => onRetry(item)}
  onDelete={() => onDelete(item)} // optional
/>
```

Default state shows "Generation failed" title + parsed message
(line-clamped to 2 lines). Hover overlays a centered button trio: retry
/ view-details / delete. View-details opens a Dialog with two sections:
parsed `Message` and raw `Response`.

The friendly-message parser lives at `apps/web/src/lib/error-message.ts`
(`extractFriendlyErrorMessage`). It handles OpenAI / Alibaba / Java
envelope shapes. Reuse it — don't write a second parser.

### User avatar

**Reference**: `apps/web/components/user-avatar.tsx`

```tsx
<UserAvatar
  src={user.headImgUrl} // resolved URL or undefined
  seed={user.id} // stable per-user seed for fallback
  name={user.nickname} // alt text
  className="size-8" // size + shape overrides (e.g. rounded-2xl)
/>
```

- Backend placeholder PNG (`d17b1d5e-282e-47e0-bd99-9a72477adf93.png`)
  is auto-filtered as "no avatar" via `isPlaceholderAvatar`.
- Fallback: DiceBear `notionists` SVG, deterministic per `seed`, with
  pastel backgroundColor palette. Seed is namespaced with `user:` so
  the same numeric id can't collide with a future crew / project avatar.
- Default shape: circle (`rounded-full` baked into Radix Avatar root).
  Override with `className="rounded-2xl"` + `imageClassName="rounded-2xl"`
  for squircle.

### Persona pills

**Reference**: `apps/web/src/lib/assistant/personas.ts` + `apps/web/app/projects/_components/ai-assistant/force-persona-pills.tsx`

Persona attribution always renders through `PERSONA_TONE_CLASSES`:

```tsx
<span
  className={cn(
    "rounded-full border px-2.5 py-1 text-xs font-medium",
    PERSONA_TONE_CLASSES[persona.tone]
  )}
>
  <Icon className="size-3.5" />
  {t(`personas.${persona.nameKey}`)}
</span>
```

Don't write inline colour classes for persona tags — the seven-tone
palette is centralised so renaming a persona's tone updates every pill
across chat / pill row / composer ring / bubble border in one place.

### Hero band — three types

The plaza pages all use the same hero contract. Three variants:

**1. Marketing hero** (used on `/`, `/art-studio`):

- Full-width background image with dark-to-transparent gradient overlay
- Eyebrow (uppercase micro) + display-xl title + body-lg description
- One primary CTA + optional secondary
- 80-128px vertical padding

**2. Plaza hero** (used on `/ips`, `/creators`, `/crews`):

- Same image + gradient pattern
- Eyebrow + display-lg title + smaller stats row (`<strong>` value + label)
- One primary CTA (Create / Apply / Browse)
- 56-80px vertical padding (denser than marketing hero)

**3. Detail hero** (used on `/ips/[id]`, `/crews/[id]`):

- Solid `surface-1` band, no background image
- Eyebrow (entity type) + display-md title + body description
- Right-anchored action cluster (Edit / Publish / Open Workspace)
- 32-48px vertical padding (densest)

**TODO:** consolidate the three variants into a single
`<HeroBand variant="marketing" | "plaza" | "detail">` component. Today
each page hand-rolls its hero — that's the work-in-progress.

---

## State reset on dialog close

```tsx
useEffect(() => {
  if (!open) {
    // reset all draft state to empty on close
    setName("");
    setDescription("");
    setPendingPath(null);
    return;
  }
  // optional: hydrate from `initial` on open (edit-mode dialogs)
  if (initial) {
    setName(initial.name);
    setDescription(initial.description ?? "");
  }
}, [open, initial]);
```

Two-phase pattern. **Reset on close, not on open.** Resetting on open
causes a visible "blank then fill" frame in edit mode.

---

## Submit button state

```tsx
<Button onClick={handleSubmit} disabled={!canSubmit}>
  {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
  {submitting ? t("submitting") : t("submit")}
</Button>
```

- `canSubmit` = required fields non-empty AND no in-flight upload AND
  not already submitting.
- Spinner + "Saving…" / "Submitting…" copy on press. Don't keep the
  static label — users need feedback the click registered.

---

## i18n

**English-first.** Every new user-facing string lands in
`apps/web/messages/en-US.json` first, then `zh-CN.json` and `zh-HK.json`
get translations. Never introduce hardcoded Chinese in TSX — even when
editing a Chinese-heavy file, the new string goes through i18n.

### Key placement

Namespace by **surface**, not by feature:

- `common.*` — generic ("Save", "Cancel", "Generation failed", error verbs)
- `auth.*` — login / register / onboarding dialogs
- `profile.*` — profile page
- `crew.*` — crews-related dialogs and components
- `workspace.*` — anything inside `/crews/[id]/workspace`
- `ip.*` — IP detail page, create-IP flow
- `storyboard.*` — storyboard editor, AI generator dialogs
- `ai.*` — assistant pills, persona names

When two namespaces both apply, use the **more specific** one.
"Publish" in the crew workspace lives in `workspace.publishCrew`, not
`crew.publish` — because the consumer is the workspace page, and that
namespace is where the consumer's `useTranslations()` call points.

### Interpolation

`{var}` curly braces, configured in `apps/web/src/i18n/i18n.ts`:

```ts
interpolation: { prefix: "{", suffix: "}" }
```

Not the i18next default `{{var}}`. Match the convention.

---

## Do's and Don'ts

### Do

- Reserve `{colors.primary}` red as a **signal** colour. Primary CTA
  fill, focus ring, destructive accent — that's it.
- Step elevation through solid surface lift (`canvas` → `surface-1` →
  `surface-2`) on persistent content. Save shadow + glass for floating UI.
- Compose every glass surface with the full cocktail: fill + blur +
  border + top inset highlight. All four are required.
- Use persona tones (`PERSONA_TONE_CLASSES`) for crew-role attribution.
  Don't substitute the brand red there — red is the BRAND, not a persona.
- Run i18n in English first, then translate.
- Match an existing pattern in this file before inventing a new one.
  If two patterns disagree, the **canonical reference** file linked
  beside each section wins.

### Don't

- Don't introduce a second chromatic brand colour (no "FizzDragon blue").
  The seven persona tones cover variety; everything else is monochrome
  - red.
- Don't ship a light-mode page. The brand is dark.
- Don't apply glass surfaces to **persistent** content panes. Workspace
  sidebar, plaza card grid, IP detail body — all stay solid. Glass is
  for floating layers only.
- Don't use `rounded.pill` on primary buttons. Pills are reserved for
  **status / persona / tag** chips. Primary buttons are `rounded.lg`.
- Don't hand-roll persona colours in JSX (`text-violet-300`, `bg-amber-500/10`).
  Route through `PERSONA_TONE_CLASSES` so the palette stays renameable.
- Don't fork a "create" dialog and an "edit" dialog into two files.
  One dialog component with an optional `initial` prop. See
  `create-crew-dialog.tsx`.
- Don't write a second error-payload parser. `extractFriendlyErrorMessage`
  handles OpenAI / Alibaba / Java envelope shapes. Add new shapes there.
- Don't use the Chinese name 气泡龙 in TSX strings. Brand display name
  is **FizzDragon** in English UI; the Chinese transliteration belongs
  in zh-CN / zh-HK translations only.

---

## References

- `apps/web/src/lib/assistant/personas.ts` — canonical persona palette.
- `apps/web/components/user-avatar.tsx` — avatar component + DiceBear fallback.
- `apps/web/app/projects/_components/storyboard/ai-generator/failed-result-card.tsx` — failure-state card.
- `apps/web/src/lib/error-message.ts` — friendly error message extractor.
- `apps/web/AGENTS.md` — Next.js 16 conventions, feature-private data layer.

---

## Iteration

This doc lives at the repo root because it's the **single source of
truth** for any UI work. When a new pattern lands:

1. Update this file with the new component / token / convention.
2. Update the canonical reference file (the one named in the relevant
   section).
3. If a second instance of the pattern exists, bring it in line.
4. Run `npm run check-types` to confirm consuming code still compiles.

Stay opinionated — every "could be either way" call should resolve to
**reduce vocabulary, not expand**. Adding a new button variant is more
expensive than reusing an existing one with a small `cn` override.
