import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CountryMiddleware } from './country.middleware';

/**
 * Wires CountryMiddleware globally so every controller sees req.country /
 * req.geo.
 */
@Global()
@Module({
  providers: [CountryMiddleware],
})
export class RegionModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CountryMiddleware).forRoutes('*');
  }
}
