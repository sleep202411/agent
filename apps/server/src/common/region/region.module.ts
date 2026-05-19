import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CountryMiddleware } from './country.middleware';

/**
 * Wires CountryMiddleware globally so every controller sees req.country.
 * Imported once from AppModule; no providers exported because the only
 * surface is the `@Country()` decorator (a free function, not a DI dep).
 */
@Module({
  providers: [CountryMiddleware],
})
export class RegionModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CountryMiddleware).forRoutes('*');
  }
}
