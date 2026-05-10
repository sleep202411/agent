import "server-only";

import type { FAQPage, WithContext } from "schema-dts";

import { absoluteUrl, entityId } from "../canonical";

export interface FaqEntry {
  question: string;
  /** Plain text. Avoid HTML — most consumers (LLMs especially)
   *  ingest FAQ as raw text and HTML adds noise. */
  answer: string;
}

/**
 * schema.org FAQPage — the highest-signal type for GEO.
 *
 * AI engines (ChatGPT / Perplexity / Google AI Overview) explicitly
 * preference FAQPage content when answering "what is X / how does
 * X work" style questions. Every IP detail page should ship one;
 * static help pages should too.
 *
 * Limits to respect:
 *   - Max ~30 entries per FAQPage (Google guidance — beyond that,
 *     ranking gain plateaus and the structured snippet truncates).
 *   - Don't gate behind interactive UI. The Q&A text must be
 *     visible in the rendered HTML (user-toggleable accordions are
 *     fine — collapsed-by-default is fine — but hidden-only
 *     accordions break Google's "matches visible content" rule).
 *   - Answers should be self-contained. Don't reference "above"
 *     or rely on visual context the FAQ extract won't carry.
 */
export function buildFaqPage(
  /** Page URL (path or absolute). Used for the @id. */
  url: string,
  faqs: FaqEntry[]
): WithContext<FAQPage> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": entityId(url, "faq"),
    url: absoluteUrl(url),
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer,
      },
    })),
  };
}
