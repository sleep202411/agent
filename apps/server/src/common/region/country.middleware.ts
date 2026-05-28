import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { CountryRequest } from './region.types';
import { CURRENT_CELL } from './current-cell';

/**
 * Attach a normalized `country` field (ISO 3166-1 alpha-2) to every
 * request based on the `x-country` header that proxy.ts (Next.js
 * edge) injects after collapsing the various CDN-specific geo
 * headers (cf-ipcountry / x-vercel-ip-country / azure-fd) into one.
 *
 * Direct callers (curl, internal service-to-service) won't carry that
 * header — default to "US" so the request still has *some* country to
 * gate on. We pick US over CN as the default because the cn cell is
 * geofenced upstream and never sees ambiguous traffic.
 *
 * This middleware is global (wired in RegionModule) and runs before
 * any controller — `@Country()` decorator just reads what's already on
 * the request.
 */
@Injectable()
export class CountryMiddleware implements NestMiddleware {
  use(req: CountryRequest, _res: Response, next: NextFunction): void {
    const fromHeader = (req.headers['x-country'] ??
      req.headers['cf-ipcountry'] ??
      req.headers['x-vercel-ip-country'] ??
      req.headers['x-azure-clientip-country']) as string | undefined;
    const normalized =
      fromHeader && fromHeader !== 'XX' ? fromHeader.toUpperCase() : 'US';
    req.country = normalized;
    req.geoContext = {
      cell: process.env.DEPLOYMENT_CELL?.trim() || CURRENT_CELL,
      country: normalized,
      ip: {
        country: normalized,
        region: this.headerString(req.headers['x-region']),
        city: this.headerString(req.headers['x-city']),
        address:
          this.headerString(req.headers['x-forwarded-for'])
            ?.split(',')[0]
            ?.trim() ??
          this.headerString(req.headers['x-real-ip']) ??
          req.ip,
        source: fromHeader ? 'cdn' : 'unknown',
        confidence: fromHeader ? 'high' : 'low',
      },
    };
    next();
  }

  private headerString(
    value: string | string[] | undefined,
  ): string | undefined {
    if (Array.isArray(value)) return value[0]?.trim() || undefined;
    return value?.trim() || undefined;
  }
}
