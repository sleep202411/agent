/**
 * Two-dimensional feature gate: cell × country.
 *
 *   - `cells`     — which deployments include this feature at all.
 *                   Cell-gated because the underlying infra differs
 *                   (Azure Foundry only in com, etc.).
 *   - `countries` — within the chosen cells, optionally restrict to a
 *                   country allow-list. Country-gated because business
 *                   or compliance differs per country (Stripe support,
 *                   GDPR notices, etc.).
 *
 * Rule shorthand:
 *   { cells: [...] }                   → all countries in those cells
 *   { cells: [...], countries: [...] } → only listed countries in those cells
 *
 * Adding a feature: append to FEATURES, then call `hasFeature("name", country)`
 * at the gate site (web component, Nest controller). Don't ever stringly
 * key — the type system enforces the lookup.
 */

import { CURRENT_CELL, type Cell } from "./cell";
import type { CountryCode } from "./country";

type FeatureRule = {
  cells: readonly Cell[];
  countries?: readonly CountryCode[];
};

export const FEATURES = {
  // Core product surfaces — available in both cells, all countries.
  crew: { cells: ["com", "cn", "global"] },
  notifications: { cells: ["com", "cn", "global"] },
  artStudio: { cells: ["com", "cn", "global"] },

  // Infra-bound: com has Azure (Foundry / Blob / Web PubSub).
  imageGeneration: { cells: ["com", "global"] },
  azureBlobUpload: { cells: ["com", "global"] },

  // cn alternatives — Java upload bridge for object storage while we
  // negotiate Alibaba OSS access.
  javaUploadBridge: { cells: ["cn"] },
  // Interactive-film clips negotiate `/playback` and play the server's HLS
  // (Aliyun IMM) where it has one. Only the cn server transcodes; keep aligned
  // with apps/server/src/common/region/features.ts.
  adaptiveStoryPlayback: { cells: ["cn"] },

  // Compliance — country-gated within com.
  gdprCookieBanner: {
    cells: ["com", "global"],
    countries: [
      "DE",
      "FR",
      "IT",
      "ES",
      "NL",
      "BE",
      "AT",
      "SE",
      "DK",
      "FI",
      "IE",
      "PT",
      "PL",
      "CZ",
      "HU",
      "GR",
    ],
  },
  ccpaPrivacyNotice: { cells: ["com", "global"], countries: ["US"] },
  pipPrivacyNotice: { cells: ["cn"] },
} as const satisfies Record<string, FeatureRule>;

export type FeatureName = keyof typeof FEATURES;

export function hasFeature(name: FeatureName, country?: CountryCode): boolean {
  const rule: FeatureRule = FEATURES[name];
  if (!rule.cells.includes(CURRENT_CELL)) return false;
  if (rule.countries && country) {
    return rule.countries.includes(country);
  }
  return true;
}
