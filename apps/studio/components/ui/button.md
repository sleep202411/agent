# Button

`components/ui/button.tsx` — the studio's one button primitive (shadcn + `cva`).
The design *rules* live in `apps/studio/DESIGN.md` (rule 3 + "Radius & shape" +
the quiet-icon recipe); this file is the *usage* reference.

```tsx
import { Button } from "@/components/ui/button";

<Button>Save</Button>
<Button variant="primary-cta" size="lg">Generate</Button>
<Button variant="ghost" onClick={onCancel}>Cancel</Button>
<Button variant="quiet" size="icon-sm" aria-label="Close"><IconX /></Button>
<Button loading disabled={busy} onClick={submit}>Publish</Button>
<Button variant="secondary" block>Continue</Button>
<Button asChild><a href="/pricing">Pricing</a></Button>
```

## Props

Everything a native `<button>` accepts (`onClick`, `disabled`, `className`,
`aria-*`, …), plus:

| Prop      | Type                                | Default     | Notes                                                                                                                                                             |
| --------- | ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `variant` | one of the variants below           | `"default"` | visual role                                                                                                                                                     |
| `size`    | one of the sizes below              | `"default"` | height + padding                                                                                                                                                |
| `loading` | `boolean`                           | `false`     | shows a spinner, sets `aria-busy`, and blocks activation — but stays **coloured and focusable** (busy ≠ disabled). Icon sizes swap the glyph for the spinner. Not auto-applied for `asChild`. |
| `block`   | `boolean`                           | `false`     | stretch to full width (`w-full`)                                                                                                                                |
| `asChild` | `boolean`                           | `false`     | render the single child element instead of a `<button>` (links, `DialogTrigger`, `DialogClose`, …), keeping the button styles                                  |
| `type`    | `"button" \| "submit" \| "reset"`   | `"button"`  | defaults to `"button"` on real buttons so it never submits a form by accident — pass `"submit"` explicitly for a form's submit control                          |
| `disabled`| `boolean`                           | —           | native disable: dims, blocks activation, and drops from the tab order                                                                                           |

`buttonVariants` is also exported, for styling a non-button element the same way
(`className={buttonVariants({ variant, size })}`).

## Variants

| Variant       | Use it for                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `default`     | a standard primary action (brand-red fill)                                                     |
| `primary-cta` | **the** hero action of a view (Generate / Upgrade …) — the "candy" treatment. **One per view.** |
| `secondary`   | a secondary action sitting beside a primary one                                                |
| `ghost`       | incidental / inline / text-adjacent actions (Cancel, Back)                                      |
| `outline`     | the sanctioned named-border action                                                             |
| `quiet`       | a standalone **icon** action on a borderless dark surface (dialog close, toolbar) — resting white-alpha fill |
| `destructive` | a destructive action — a translucent red **tint** with red text (never a solid red fill)       |
| `link`        | a button that reads as a text link                                                             |

With a red primary, reach for `ghost` / `secondary` / `quiet` on incidental
actions — using `default` everywhere shouts (DESIGN.md rule 3).

## Sizes

| Size      | Height | Icon-only variant |
| --------- | ------ | ----------------- |
| `xs`      | 24px   | `icon-xs` (24px)  |
| `sm`      | 28px   | `icon-sm` (28px)  |
| `default` | 36px   | `icon` (36px)     |
| `lg`      | 40px   | `icon-lg` (40px)  |
| `xl`      | 44px   | `icon-xl` (44px)  |

## Icons

Pass icons as children (SVG); they are auto-sized to the button's size. For the
tighter optical padding when a button carries a leading/trailing icon, tag the
icon with `data-icon`:

```tsx
<Button><IconPlus data-icon="inline-start" /> New project</Button>
<Button>Continue <IconArrowRight data-icon="inline-end" /></Button>
```

## Gotchas

- **One `primary-cta` per view** — its glow + sheen is the loudest thing on
  screen; a second one dilutes both.
- **Icon-only buttons need an `aria-label`.**
- **`asChild` takes exactly one child** and skips the `loading` spinner (a Slot
  can't hold two children) — compose the spinner yourself if a link needs one.
- **Form submit**: the default `type` is `"button"`, so a form's submit control
  must set `type="submit"` explicitly.
- **`loading` is not `disabled`**: a loading button keeps its colour and stays
  focusable (it announces "busy"). Use `disabled` to truly disable.
