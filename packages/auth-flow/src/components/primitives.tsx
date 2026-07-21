"use client";

/**
 * The dialog's own primitives — plain elements plus semantic Tailwind
 * tokens, deliberately NOT shadcn.
 *
 * Importing `apps/web`'s shadcn would drag its `--primary` red, its
 * borders and its `cn` into `apps/studio`, whose DESIGN.md forbids
 * control borders and brand red as a token. These are written to
 * studio's stricter rules (rule 4: no borders — separation comes from
 * tone steps; rule 2: monochrome tokens only), which `apps/web` absorbs
 * without complaint because its own tokens resolve to its palette.
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { forwardRef, useId } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Label → control → error rhythm, shared by every step. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-full">
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint ? <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/**
 * Filled control, no outline: `bg-input` is a white-alpha token in both
 * apps, so the same class reads as a quiet fill on either background.
 */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        {...props}
        className={cx(
          "h-11 w-full rounded-xl border-0 bg-input/30 px-3.5 text-base text-foreground outline-none",
          "placeholder:text-muted-foreground/70",
          "focus-visible:ring-2 focus-visible:ring-ring/60",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "sm:text-sm",
          className
        )}
      />
    );
  }
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyLabel?: string };

/** The single hero action of every step. */
export function PrimaryButton({ busy, busyLabel, children, className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cx(
        "flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4",
        "text-sm font-semibold text-primary-foreground transition-opacity",
        "hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
    >
      {busy ? <Spinner label={busyLabel} /> : null}
      {children}
    </button>
  );
}

/** Secondary / skip action. Text-weight, no fill, no border. */
export function QuietButton({ busy, busyLabel, children, className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium",
        "text-muted-foreground transition-colors hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
    >
      {busy ? <Spinner label={busyLabel} /> : null}
      {children}
    </button>
  );
}

/**
 * Quiet icon button — the dialog close / back affordance.
 *
 * This is studio DESIGN.md's "Quiet icon button" recipe (§ Component
 * system), which is NORMATIVE for a standalone secondary icon action on a
 * borderless dark surface, reproduced value-for-value: hit area `size-7`,
 * `rounded-lg`, resting `bg-white/[0.06] text-white/55`, hover
 * `bg-white/[0.12] hover:text-white`, focus `focus-visible:ring-2
 * focus-visible:ring-white/35`, `size-4` icons, `transition`.
 *
 * White-alpha rather than the `muted` / `accent` tokens on purpose: both
 * hosts are dark-only (studio's rule 1; web's DESIGN.md `mode.policy`),
 * and DESIGN.md sanctions white-alpha FILLS as the frosted-chrome idiom.
 * The one white-alpha ring here is the focus ring, which rule 4 exempts
 * and the recipe specifies outright.
 */
export function IconButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      className={cx(
        "flex size-7 items-center justify-center rounded-lg bg-white/[0.06] text-white/55",
        "transition hover:bg-white/[0.12] hover:text-white",
        "focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
    >
      {children}
    </button>
  );
}

/**
 * Inline error. `destructive` is the one sanctioned chromatic token —
 * error semantics need color (studio DESIGN.md rule 2, exception 1).
 *
 * `detail` carries the upstream message verbatim under our own copy. It
 * is not decoration: Java has no machine-readable error codes yet, so
 * the localized line above it is a heuristic guess, and root DESIGN.md
 * § Error Toasts requires the actionable server text to survive whether
 * or not that guess landed.
 */
export function ErrorNotice({
  id,
  detail,
  children,
}: {
  id?: string;
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div id={id} role="alert" aria-live="polite" className="text-xs leading-5 text-destructive">
      <p>{children}</p>
      {detail ? <p className="mt-0.5 text-destructive/70">{detail}</p> : null}
    </div>
  );
}

export function Spinner({ label, className }: { label?: string; className?: string }) {
  const titleId = useId();
  return (
    <svg
      className={cx("size-4 shrink-0 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? "img" : "presentation"}
      aria-hidden={label ? undefined : true}
      aria-labelledby={label ? titleId : undefined}
    >
      {label ? <title id={titleId}>{label}</title> : null}
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* Icons are inline SVG so the package stays dependency-free — pulling in
   an icon library would pin both apps to the same version of it. */

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
      <path
        d="m6 6 12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
      <path
        d="M15 5 8 12l7 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
      <path
        d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.1-2h6.4l1.1 2h1.7A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      {off ? (
        <path d="m4 20 16-16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}
