import type { Metadata } from "next";

import { JsonLd } from "@/src/lib/seo";
import { buildBreadcrumbList } from "@/src/lib/seo/builders/breadcrumb";
import { buildFaqPage } from "@/src/lib/seo/builders/faqpage";

import { CategoryRail } from "./_components/category-rail";
import { FaqHero } from "./_components/faq-hero";
import { FaqSection } from "./_components/faq-section";
import { FAQ_CATEGORIES, TOTAL_FAQ_COUNT } from "./_data/faqs";

/**
 * Public FAQ page. Server Component on purpose — every Q&A pair must
 * land in the SSR'd HTML so LLM crawlers (GPTBot / ClaudeBot /
 * PerplexityBot / Google AI Overview) can ingest the full content
 * without executing JS. The page also injects a schema.org FAQPage
 * JSON-LD blob so the structured data is explicit.
 *
 * Why one `<JsonLd>` carrying the full 50-entry FAQPage instead of
 * five (one per category):
 *  - The page itself is one document; splitting fragments the @id
 *    namespace and confuses some validators.
 *  - The ~30-entry "soft cap" Google publishes is a ranking-decay
 *    boundary, not a rejection threshold — beyond 30 the structured
 *    snippet plateaus, but the data is still indexed and citable by
 *    LLM engines (Perplexity / ChatGPT happily ingest 50+).
 */
export const metadata: Metadata = {
  title: "FAQ · FizzDragon",
  description:
    "About FizzDragon and AI cinema — production flow, cost, timeline, technology, partnerships and what comes next. 50 plain-language answers based on real shipped work.",
  alternates: {
    canonical: "/faq",
  },
  openGraph: {
    title: "FAQ · FizzDragon",
    description:
      "About FizzDragon and AI cinema — 50 plain-language answers based on real shipped work.",
    type: "website",
  },
};

export default function FaqPage() {
  // Flatten Q&A entries for the JSON-LD blob — schema.org FAQPage
  // wants `mainEntity[].Question` regardless of how we render
  // sections in HTML.
  const allEntries = FAQ_CATEGORIES.flatMap((cat) => cat.items).map((it) => ({
    question: it.question,
    answer: it.answer,
  }));

  const faqJsonLd = buildFaqPage("/faq", allEntries);
  const breadcrumbJsonLd = buildBreadcrumbList([
    { name: "Home", url: "/" },
    { name: "FAQ", url: "/faq" },
  ]);

  // Running ordinal so each FaqItem renders its absolute 1..50 number
  // across the five sections, matching the `q-N` anchor convention.
  let runningOrdinal = 1;

  return (
    <main className="min-h-screen bg-background scroll-smooth">
      <JsonLd data={[faqJsonLd, breadcrumbJsonLd]} />

      <FaqHero />

      <div className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
          <CategoryRail />

          <div className="space-y-14">
            {FAQ_CATEGORIES.map((category) => {
              const startOrdinal = runningOrdinal;
              runningOrdinal += category.items.length;
              return (
                <FaqSection key={category.id} category={category} startOrdinal={startOrdinal} />
              );
            })}

            {/* Closing note — for the few users who actually scroll
                through all 50, give them an off-ramp. */}
            <footer className="rounded-2xl border border-border bg-card px-6 py-8 text-center">
              <p className="text-sm font-semibold text-foreground">没找到你的问题？</p>
              <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
                以上 {TOTAL_FAQ_COUNT} 条覆盖了 FizzDragon 与 AI 电影最常被问到的方向，欢迎通过官网
                fizzdragon.com 或社交媒体联系我们获取更深入的信息。
              </p>
            </footer>
          </div>
        </div>
      </div>
    </main>
  );
}
