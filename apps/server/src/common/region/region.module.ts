import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CountryMiddleware } from './country.middleware';
import { GeoPolicyService } from './geo-policy.service';

/**
 * Wires CountryMiddleware globally so every controller sees req.country /
 * req.geo. GeoPolicyService is exported for routing, billing, and future
 * payment-country policy checks.
 */
@Global()
@Module({
  providers: [CountryMiddleware, GeoPolicyService],
  exports: [GeoPolicyService],
})
export class RegionModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CountryMiddleware).forRoutes('*');
  }
}
