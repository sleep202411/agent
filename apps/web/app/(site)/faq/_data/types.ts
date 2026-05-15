/**
 * Shared types for the FAQ data layer. Each locale exports a
 * `FaqCategory[]` that conforms to these shapes — `_data/index.ts`
 * wires them into `FAQ_BY_LOCALE` so the page can pick by `useLocale()`.
 */

export interface FaqItem {
  /** Stable anchor id, e.g. `q-1`..`q-50`. **Must** match across all
   *  three locale files so deep links survive a language switch. */
  id: string;
  question: string;
  answer: string;
}

export interface FaqCategory {
  /** Anchor id for the category section, e.g. `cat-tech`. Same id
   *  across locales — only the visible title / description differ. */
  id: string;
  title: string;
  description: string;
  items: FaqItem[];
}
