import type { FaqShell } from "../_data";

interface FaqHeroProps {
  shell: FaqShell;
}

/**
 * FAQ page header. Pure presentation, no interactivity — kept as a
 * Server Component so the H1 + intro paragraph land in the SSR HTML
 * (matters for LLM crawlers that don't run JS). Copy comes from
 * `FaqShell` selected per-locale in the parent.
 */
export function FaqHero({ shell }: FaqHeroProps) {
  return (
    <header className="relative overflow-hidden border-b border-border bg-gradient-to-b from-card via-card to-background px-6 py-16 sm:py-20">
      {/* Background glow accent — purely decorative. */}
      <div
        aria-hidden
        className="absolute inset-x-0 -top-32 mx-auto h-64 max-w-3xl bg-gradient-to-r from-primary/20 via-fuchsia-500/20 to-amber-500/20 blur-3xl"
      />
      <div className="relative mx-auto max-w-5xl text-center">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.32em] text-primary/80">
          {shell.heroEyebrow}
        </p>
        <h1 className="text-3xl font-black leading-tight text-foreground sm:text-5xl">
          {shell.heroTitle}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {shell.heroIntro}
        </p>
      </div>
    </header>
  );
}
