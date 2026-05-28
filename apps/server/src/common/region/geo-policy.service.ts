import { Injectable } from '@nestjs/common';
import type { GeoContext, GeoPolicy, GeoPolicyDecision } from './region.types';

@Injectable()
export class GeoPolicyService {
  evaluate(policy: GeoPolicy | undefined, geo: GeoContext): GeoPolicyDecision {
    if (!policy) return { allowed: true };

    if (policy.blockedCells?.includes(geo.cell)) {
      return {
        allowed: false,
        reason: `Unavailable in deployment cell ${geo.cell}.`,
      };
    }
    if (
      policy.allowedCells?.length &&
      !policy.allowedCells.includes(geo.cell)
    ) {
      return {
        allowed: false,
        reason: `Not enabled for deployment cell ${geo.cell}.`,
      };
    }
    if (policy.blockedCountries?.includes(geo.country)) {
      return {
        allowed: false,
        reason: `Unavailable in ${geo.country}.`,
      };
    }
    if (
      policy.allowedCountries?.length &&
      !policy.allowedCountries.includes(geo.country)
    ) {
      return {
        allowed: false,
        reason: `Not enabled for ${geo.country}.`,
      };
    }
    return { allowed: true };
  }

  snapshot(geo: GeoContext) {
    return {
      cell: geo.cell,
      country: geo.country,
      ip: {
        country: geo.ip.country,
        region: geo.ip.region,
        city: geo.ip.city,
        source: geo.ip.source,
        confidence: geo.ip.confidence,
      },
      user: geo.user,
      billing: geo.billing,
    };
  }
}
