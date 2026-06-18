"use client";

/**
 * Plaza Hero — shared hero band for `/crews`, `/creators`, `/courses`.
 *
 * Composition:
 *   ┌─ optional background image + legibility overlays
 *   ├─ radial ambient (two ellipses, palette via `ambient` prop)
 *   └─ centered content column
 *       ├─ eyebrow (icon + label + optional meta)
 *       ├─ title (plain + optional accent on a second line, gradient text)
 *       ├─ subtitle (1-2 lines)
 *       ├─ stats row (key/value pairs, optional leading colored dot + cap)
 *       └─ primary CTA
 *
 * `rightSlot` floats absolute bottom-right at md+ for plaza-specific
 * sub-actions (creators' WeChat-group QR popover, etc.). Below md it
 * falls back into the column flow so it doesn't fight the headline for
 * horizontal space.
 *
 * Three pages explicitly do NOT use this:
 *   - `/`             — full-screen cinematic video hero, fully custom
 *   - `/ips`          — Netflix-style featured carousel
 *   - `/news`         — minimal centered title + subscribe form
 *   - `/art-studio`   — composer-as-hero (input is the hero)
 *
 * See DESIGN.md § "Hero band — three types" for the canonical reference.
 */

import { cn } from "@/lib/utils";
import type { Icon } from "@tabler/icons-react";

type AmbientPalette = "amber" | "blue";

interface AmbientStyle {
  /** CSS `background-image` value for two-ellipse radial wash. */
  radial: string;
  /** Eyebrow text + icon color (Tailwind class). */
  eyebrow: string;
  /** Decorative leading dot color (Tailwind class). */
  dot: string;
}

const AMBIENT: Record<AmbientPalette, AmbientStyle> = {
  // Default — amber leaning, used by /creators and /courses.
  amber: {
    radial:
      "radial-gradient(ellipse 50% 50% at 20% 30%, hsl(42 95% 55% / 0.08) 0%, transparent 60%), radial-gradient(ellipse 40% 40% at 80% 60%, hsl(280 60% 55% / 0.06) 0%, transparent 60%)",
    eyebrow: "text-amber-400",
    dot: "bg-amber-400",
  },
  // Cooler palette — used by /crews (paired with a real background image).
  blue: {
    radial:
      "radial-gradient(circle at 15% 50%, hsl(210 100% 56% / 0.12) 0%, transparent 55%), radial-gradient(circle at 85% 20%, hsl(0 78% 52% / 0.10) 0%, transparent 50%)",
    eyebrow: "text-primary",
    dot: "bg-primary",
  },
};

export interface PlazaHeroProps {
  eyebrow: {
    icon: Icon;
    label: string;
    /** Optional secondary label after a middle-dot separator. */
    meta?: string;
  };
  title: {
    plain: string;
    /** Optional second-line accent — rendered as a gradient-clipped span on its own line. */
    accent?: string;
    /** Tailwind gradient direction + stops, e.g. `from-amber-400 to-orange-500`.
     *  Defaults to the palette-matching pair for `ambient`. */
    accentGradient?: string;
  };
  subtitle?: string;
  /** Inline stats row. When present, renders below the subtitle. */
  stats?: {
    items: Array<{ value: React.ReactNode; label: string }>;
    /** Trailing capacity / qualifier text (e.g. "first 50 only"). */
    cap?: string;
    /** Show a coloured dot before the first stat — matches the
     *  /creators + /courses pattern. */
    dotted?: boolean;
  };
  /** Primary call-to-action (Button / Link). Left-aligned by default. */
  cta?: React.ReactNode;
  /** Right-side cluster — floats absolute bottom-right at md+, stacks
   *  inline at smaller breakpoints. Use for plaza-specific secondary
   *  actions that don't belong in the main CTA (e.g. WeChat QR). */
  rightSlot?: React.ReactNode;
  /** Optional full-bleed background image URL. When present, the hero
   *  also gets a left-to-right legibility gradient + a bottom fade into
   *  the page canvas. */
  backgroundImage?: string;
  /** Radial wash palette. Defaults to `amber`. */
  ambient?: AmbientPalette;
  className?: string;
}

// Default gradient pairs per ambient — keeps callers from having to
// remember the colour vocabulary every time.
const DEFAULT_ACCENT_GRADIENT: Record<AmbientPalette, string> = {
  amber: "from-amber-400 to-orange-500",
  blue: "from-blue-400 to-cyan-400",
};

export function PlazaHero({
  eyebrow,
  title,
  subtitle,
  stats,
  cta,
  rightSlot,
  backgroundImage,
  ambient = "amber",
  className,
}: PlazaHeroProps) {
  const palette = AMBIENT[ambient];
  const EyebrowIcon = eyebrow.icon;
  const accentGradient = title.accentGradient ?? DEFAULT_ACCENT_GRADIENT[ambient];

  return (
    <section className={cn("relative overflow-hidden border-b border-border", className)}>
      {/* Backdrop image (optional) — half-opacity to let radial + content
          dominate; legibility gradient pulls left side to canvas. */}
      {backgroundImage ? (
        <>
          <img
            src={backgroundImage}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-cover object-[80%_center] opacity-50"
          />
          <div className="absolute inset-0 bg-linear-to-r from-background via-background/85 to-background/30" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-linear-to-b from-transparent to-background" />
        </>
      ) : null}

      {/* Ambient radial wash — two coloured ellipses per palette. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: palette.radial }}
      />

      <div className="relative mx-auto w-full max-w-450 px-6 pb-12 pt-16">
        <div className="max-w-3xl">
          {/* Eyebrow */}
          <div
            className={cn(
              "flex items-center gap-2 text-xs font-bold uppercase tracking-widest",
              palette.eyebrow
            )}
          >
            <EyebrowIcon className="size-4" />
            {eyebrow.label}
            {eyebrow.meta ? (
              <>
                <span className="text-muted-foreground/60">·</span>
                <span className="text-muted-foreground">{eyebrow.meta}</span>
              </>
            ) : null}
          </div>

          {/* Title — plain on first line, optional gradient accent on
              the second. Both share the same display-sm typography
              tier (text-4xl md:text-5xl). */}
          <h1 className="mt-4 text-4xl font-black leading-[1.1] tracking-tight text-foreground md:text-5xl">
            {title.plain}
            {title.accent ? (
              <>
                <br />
                <span
                  className={cn("bg-linear-to-r bg-clip-text text-transparent", accentGradient)}
                >
                  {title.accent}
                </span>
              </>
            ) : null}
          </h1>

          {/* Subtitle */}
          {subtitle ? (
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
              {subtitle}
            </p>
          ) : null}

          {/* Stats row */}
          {stats && (stats.items.length > 0 || stats.cap) ? (
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {stats.items.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  {stats.dotted && i === 0 ? (
                    <span className={cn("size-1.5 rounded-full", palette.dot)} />
                  ) : null}
                  <strong className="text-foreground">{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
              {stats.cap ? (
                <span className="text-xs text-muted-foreground/70">{stats.cap}</span>
              ) : null}
            </div>
          ) : null}

          {/* CTA */}
          {cta ? <div className="mt-6">{cta}</div> : null}
        </div>

        {/* Right-side cluster — md+ floats bottom-right; below md it
            stacks below the main column. */}
        {rightSlot ? (
          <div className="mt-8 flex flex-col items-stretch gap-3 md:absolute md:right-6 md:bottom-12 md:mt-0 md:items-end">
            {rightSlot}
          </div>
        ) : null}
      </div>
    </section>
  );
}
