/**
 * React Query keys for the session user. Kept free of React / i18n
 * imports so Server Components (e.g. root layout SSR hydrate) can
 * seed the cache without pulling `react-i18next` into the RSC graph.
 */

export const userKeys = {
  /** Prefix for all locale variants — use with invalidate/removeQueries. */
  info: ["user", "info"] as const,
  /** Locale-scoped user info. Level/role labels come from Java in Accept-Language. */
  infoOf: (locale: string) => ["user", "info", locale] as const,
  credits: ["user", "credits"] as const,
  accountCredits: (accountId: string | null) => ["user", "credits", accountId] as const,
};
