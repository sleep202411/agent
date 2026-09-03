import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // `rounded-xl` = 14px in this app's radius scale — the "control" step of
  // DESIGN.md "Radius & shape", which the old `rounded-md` (8px) predated.
  // Interaction states: `:disabled` (native) and `aria-disabled` (for asChild
  // targets that can't take the native attribute, e.g. <a>) both dim + block
  // pointers; `data-loading` blocks pointers with a wait cursor but keeps full
  // colour — a loading button is "busy", not "disabled".
  "group/button inline-flex shrink-0 items-center justify-center rounded-xl border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[loading=true]:pointer-events-none data-[loading=true]:cursor-wait aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The brand red (2026-08-04: `primary` IS the brand colour). Hover
        // DARKENS rather than fading to `primary/80` — a translucent CTA over a
        // near-black page reads as disabled, not as pressed.
        default:
          "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),black_14%)]",
        // The hero CTA (Generate / Create / Upgrade …) — the "candy" treatment:
        // the imagine.art Generate button in brand red. Radial fill, a soft red
        // glow, a constant dark-red bevel, a top gloss and a slow sheen, with a
        // real downward displacement on press (shape/height never change). The
        // whole look lives in `.cta-candy` (globals.css), derived from
        // `--primary`, so the brand stays one token. Shares the 14px control
        // radius with `default`; the difference is treatment + intent (the ONE
        // hero action per view), not shape. Landed 2026-08-04 (apps/studio).
        // Focus ring is white, not red — a red ring on the red fill is invisible
        // (WCAG 2.4.7).
        "primary-cta":
          "cta-candy text-primary-foreground focus-visible:border-transparent focus-visible:ring-white/70",
        outline:
          "border-border hover:bg-input/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        "primary-ghost":
          "border-primary/45 bg-primary/[0.08] text-primary hover:border-primary/70 hover:bg-primary/15 hover:text-primary focus-visible:border-primary/70 focus-visible:ring-primary/25 aria-expanded:border-primary/70 aria-expanded:bg-primary/15 aria-expanded:text-primary",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        // The "quiet icon button" of DESIGN.md's component system, codified
        // 2026-07-20 and until now having no implementation — which is why 128
        // hand-written <button>s on canvas surfaces drifted across alpha
        // 0.05–0.14 and four radii. A resting white-alpha fill (a bare ghost
        // reads as unanchored on a borderless dark panel), deepening on hover;
        // open/expanded states hold the hover fill so a toggled control looks
        // held down. Fills only — never a white-alpha ring (rule 4).
        quiet:
          "bg-white/[0.06] text-white/55 hover:bg-white/[0.12] hover:text-white focus-visible:border-transparent focus-visible:ring-white/35 aria-expanded:bg-white/[0.12] aria-expanded:text-white data-[state=open]:bg-white/[0.12] data-[state=open]:text-white",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Sizes moved up one notch on 2026-08-04: the old default (28px) was a
      // dense-panel size masquerading as the default, so it sat 8px shorter
      // than the h-9 controls hand-written beside it (the most common height in
      // the app, 43 uses) and read as timid for a primary action in this genre.
      // `default` is now that comfortable 36px; the dense sizes are still here,
      // asked for by name.
      size: {
        default:
          "h-9 gap-1.5 px-3.5 text-xs/relaxed has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-4",
        xs: "h-6 gap-1 rounded-md px-2 text-[0.625rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-lg px-2.5 text-xs/relaxed has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 text-sm/relaxed has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5 [&_svg:not([class*='size-'])]:size-4",
        xl: "h-11 gap-2 px-5 text-sm/relaxed has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4 [&_svg:not([class*='size-'])]:size-[18px]",
        icon: "size-9 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-[18px]",
        "icon-xl": "size-11 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

/** Spinner shown while a Button is `loading`. Sized by the button's size variant
 *  (it has no `size-*` class, so the `[&_svg…]:size-*` rules apply). Kept
 *  spinning under `prefers-reduced-motion` — it is essential progress feedback,
 *  not decoration. */
function ButtonSpinner() {
  return (
    <svg
      data-slot="button-spinner"
      className="animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        className="opacity-25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Show a spinner, mark the button `aria-busy`, and block activation while a
     *  pending action runs. Unlike `disabled`, a loading button keeps its colour
     *  and stays focusable (it announces "busy", not "disabled"). Ignored for
     *  `asChild` — a Slot takes a single child, so compose the spinner yourself. */
    loading?: boolean;
    /** Stretch to fill the container's width. */
    block?: boolean;
  };

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  block = false,
  type,
  disabled,
  onClick,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const inert = loading || disabled;
  const iconOnly = typeof size === "string" && size.startsWith("icon");
  // Slot renders a single child, so only inject the spinner for real buttons.
  const showSpinner = loading && !asChild;

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      // A native <button> without `type` defaults to "submit" and will silently
      // submit an enclosing <form>. Default to "button"; callers opt into
      // submit/reset with `type`. asChild targets may be non-buttons (<a>), so
      // only real buttons get the default.
      type={asChild ? type : (type ?? "button")}
      // `disabled` → the native attribute on real buttons (drops from the tab
      // order, blocks activation). For asChild the native attribute is invalid,
      // so the state rides on `aria-disabled` + the styles keyed off it.
      disabled={asChild ? undefined : disabled}
      aria-disabled={(asChild && disabled) || undefined}
      aria-busy={loading || undefined}
      // Belt-and-braces: native `disabled` already blocks clicks, but this also
      // covers loading (not natively disabled) and keyboard-activated asChild.
      onClick={(event) => {
        if (inert) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cn(buttonVariants({ variant, size }), block && "w-full", className)}
      {...props}
    >
      {asChild ? (
        // Slot requires exactly one child — pass it straight through (spinner
        // injection is skipped for asChild, per the `loading` prop's contract).
        children
      ) : (
        <>
          {showSpinner ? <ButtonSpinner /> : null}
          {/* An icon-only button swaps its glyph for the spinner; a labelled
              button keeps its label beside it. */}
          {showSpinner && iconOnly ? null : children}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
