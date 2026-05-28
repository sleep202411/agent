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

export type GeoSignalSource =
  | 'cdn'
  | 'proxy'
  | 'maxmind'
  | 'manual'
  | 'unknown';
export type GeoConfidence = 'high' | 'medium' | 'low';

export interface GeoIpSignal {
  country: CountryCode;
  region?: string;
  city?: string;
  /**
   * Raw client IP is intentionally optional. Most product policy only
   * needs country/cell; modules that need raw IP for fraud controls
   * should make an explicit data-retention decision before persisting it.
   */
  address?: string;
  source: GeoSignalSource;
  confidence: GeoConfidence;
}

export interface UserGeoSignal {
  accountCountry?: CountryCode;
  phoneCountry?: CountryCode;
  kycCountry?: CountryCode;
}

export interface BillingGeoSignal {
  billingCountry?: CountryCode;
  paymentCountry?: CountryCode;
  currency?: string;
}

export interface GeoContext {
  /**
   * Deployment cell, not user geography. Today this maps to cn/com/global;
   * future values can be global-azure-sg, global-azure-eu, etc.
   */
  cell: string;
  country: CountryCode;
  ip: GeoIpSignal;
  user?: UserGeoSignal;
  billing?: BillingGeoSignal;
}

export interface GeoPolicy {
  allowedCells?: string[];
  blockedCells?: string[];
  allowedCountries?: CountryCode[];
  blockedCountries?: CountryCode[];
  preferredProviderRegions?: string[];
}

export interface GeoPolicyDecision {
  allowed: boolean;
  reason?: string;
}

/** Express Request augmented with country/geo (in addition to AuthGuard's `user`). */
export interface CountryRequest extends Request {
  country: CountryCode;
  geoContext: GeoContext;
}
