import type { Metadata } from "next";
import { headers } from "next/headers";

import { JsonLd } from "@/src/lib/seo";
import { buildBreadcrumbList } from "@/src/lib/seo/builders/breadcrumb";
import { buildFaqPage } from "@/src/lib/seo/builders/faqpage";
import type { Locale } from "@/src/i18n/config";

import { CategoryRail } from "./_components/category-rail";
import { FaqHero } from "./_components/faq-hero";
import { FaqSection } from "./_components/faq-section";
import { getFaqForLocale, getFaqShellForLocale } from "./_data";

/**
 * Public FAQ page. Server Component on purpose — every Q&A pair must
 * land in the SSR'd HTML so LLM crawlers (GPTBot / ClaudeBot /
 * PerplexityBot / Google AI Overview) can ingest the full content
 * without executing JS. The page also injects a schema.org FAQPage
 * JSON-LD blob so the structured data is explicit.
 *
 * Locale resolution: `proxy.ts` parses the URL's locale prefix and
 * writes it to the `x-locale` request header — we read it here and
 * select the matching Q&A list + shell copy. A locale switch
 * (header / footer link) navigates to a different URL prefix, which
 * causes the proxy to attach a new header on the next render.
 *
 * Why one `<JsonLd>` carrying the full FAQPage instead of one per
 * category: the page itself is one document; splitting fragments the
 * @id namespace and confuses some validators. Google's ~30-entry
 * "soft cap" is a ranking-decay boundary, not a rejection threshold
 * — beyond 30 the structured snippet plateaus, but the data is still
 * indexed and citable by LLM engines (Perplexity / ChatGPT ingest
 * 50+ entries happily).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = ((await headers()).get("x-locale") ?? "en-US") as Locale;
  const shell = getFaqShellForLocale(locale);
  return {
    title: shell.metaTitle,
    description: shell.metaDescription,
    alternates: { canonical: "/faq" },
    openGraph: {
      title: shell.metaOgTitle,
      description: shell.metaOgDescription,
      type: "website",
    },
  };
}

export default async function FaqPage() {
  const locale = ((await headers()).get("x-locale") ?? "en-US") as Locale;
  const categories = getFaqForLocale(locale);
  const shell = getFaqShellForLocale(locale);

  // Flatten Q&A entries for the JSON-LD blob — schema.org FAQPage
  // wants `mainEntity[].Question` regardless of how we render
  // sections in HTML.
  const allEntries = categories
    .flatMap((cat) => cat.items)
    .map((it) => ({ question: it.question, answer: it.answer }));

  const faqJsonLd = buildFaqPage("/faq", allEntries);
  const breadcrumbJsonLd = buildBreadcrumbList([
    { name: shell.breadcrumbHome, url: "/" },
    { name: shell.breadcrumbFaq, url: "/faq" },
  ]);

  // Running ordinal so each FaqItem renders its absolute 1..N number
  // across the five sections, matching the `q-N` anchor convention.
  let runningOrdinal = 1;

  return (
    <main className="min-h-screen bg-background scroll-smooth">
      <JsonLd data={[faqJsonLd, breadcrumbJsonLd]} />

      <FaqHero shell={shell} />

      <div className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
          <CategoryRail categories={categories} shell={shell} />

          <div className="space-y-14">
            {categories.map((category) => {
              const startOrdinal = runningOrdinal;
              runningOrdinal += category.items.length;
              return (
                <FaqSection key={category.id} category={category} startOrdinal={startOrdinal} />
              );
            })}

            {/* Closing note — for the few users who actually scroll
                through everything, give them an off-ramp. */}
            <footer className="rounded-2xl border border-border bg-card px-6 py-8 text-center">
              <p className="text-sm font-semibold text-foreground">{shell.closingTitle}</p>
              <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
                {shell.closingBody}
              </p>
            </footer>
          </div>
        </div>
      </div>
    </main>
  );
}
