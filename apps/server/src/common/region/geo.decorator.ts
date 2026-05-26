import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CURRENT_CELL } from './current-cell';
import type {
  CountryRequest,
  GeoContext as RequestGeoContextValue,
} from './region.types';

export const GeoContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestGeoContextValue => {
    const req = ctx.switchToHttp().getRequest<CountryRequest>();
    return (
      req.geoContext ?? {
        cell: process.env.DEPLOYMENT_CELL?.trim() || CURRENT_CELL,
        country: req.country ?? 'US',
        ip: {
          country: req.country ?? 'US',
          source: 'unknown',
          confidence: 'low',
        },
      }
    );
  },
);
