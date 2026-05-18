/**
 * Region types shared by middleware, decorator, and feature gates.
 *
 * Mirror image of apps/web/src/lib/region/. The two trees evolve
 * together — if you add a Cell value here, add it there too (and
 * vice versa for FEATURES).
 */

import type { Request } from 'express';

export const CELLS = ['com', 'cn', 'global'] as const;
export type Cell = (typeof CELLS)[number];

/** ISO 3166-1 alpha-2. Bare string type — see web/country.ts rationale. */
export type CountryCode = string;

/** Express Request augmented with country (in addition to AuthGuard's `user`). */
export interface CountryRequest extends Request {
  country: CountryCode;
}
