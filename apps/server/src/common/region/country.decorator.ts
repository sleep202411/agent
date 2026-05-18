import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CountryCode, CountryRequest } from './region.types';

/**
 * Pull the per-request country off the express request.
 *
 *   @Get('payment/methods')
 *   listMethods(@Country() country: CountryCode) {
 *     return this.svc.methodsForCountry(country);
 *   }
 *
 * CountryMiddleware guarantees `req.country` is always populated, so
 * the decorator never returns undefined.
 */
export const Country = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CountryCode => {
    const req = ctx.switchToHttp().getRequest<CountryRequest>();
    return req.country ?? 'US';
  },
);
