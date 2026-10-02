/**
 * Server-side feature gate. Keep aligned with apps/web/src/lib/region/features.ts
 * — both trees consult the same matrix at different layers (web hides
 * UI; server enforces by 403'ing the endpoint).
 *
 * If a feature is web-only (e.g. a UI affordance) it doesn't need an
 * entry here. If it's a server endpoint guarded by region, add it.
 */

import { CURRENT_CELL } from './current-cell';
import type { Cell, CountryCode } from './region.types';

type FeatureRule = {
  cells: readonly Cell[];
  countries?: readonly CountryCode[];
};

export const FEATURES = {
  crew: { cells: ['com', 'cn', 'global'] },
  notifications: { cells: ['com', 'cn', 'global'] },
  imageGeneration: { cells: ['com', 'global'] },
  azureBlobUpload: { cells: ['com', 'global'] },
  javaUploadBridge: { cells: ['cn'] },
  // IMM-transcoded HLS for published free interactive films: the playback
  // reconcile loop, its admin endpoints and their boot-time config assertion.
  adaptiveStoryPlayback: { cells: ['cn'] },
} as const satisfies Record<string, FeatureRule>;

export type FeatureName = keyof typeof FEATURES;

export function hasFeature(name: FeatureName, country?: CountryCode): boolean {
  const rule: FeatureRule = FEATURES[name];
  if (!rule.cells.includes(CURRENT_CELL)) return false;
  if (rule.countries && country) return rule.countries.includes(country);
  return true;
}
