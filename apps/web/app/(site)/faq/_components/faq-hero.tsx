import { TOTAL_FAQ_COUNT } from "../_data/faqs";

/**
 * FAQ page header. Pure presentation, no interactivity — kept as a
 * Server Component so the H1 + intro paragraph land in the SSR HTML
 * (matters for LLM crawlers that don't run JS).
 */
export function FaqHero() {
  return (
    <header className="relative overflow-hidden border-b border-border bg-gradient-to-b from-card via-card to-background px-6 py-16 sm:py-20">
      {/* Background glow accent — purely decorative. */}
      <div
        aria-hidden
        className="absolute inset-x-0 -top-32 mx-auto h-64 max-w-3xl bg-gradient-to-r from-primary/20 via-fuchsia-500/20 to-amber-500/20 blur-3xl"
      />
      <div className="relative mx-auto max-w-5xl text-center">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.32em] text-primary/80">
          FizzDragon · FAQ
        </p>
        <h1 className="text-3xl font-black leading-tight text-foreground sm:text-5xl">
          关于 FizzDragon 与 AI 电影的 {TOTAL_FAQ_COUNT} 个问题
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          从制作流程、技术原理，到价格、合作方式与未来路线 ——
          覆盖创作者、客户、投资方与好奇者最常关心的核心问题。每一条都基于已落地的产品与作品事实。
        </p>
      </div>
    </header>
  );
}
