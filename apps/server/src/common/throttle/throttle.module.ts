import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

/**
 * Global so any controller / service can inject RateLimitService
 * without importing this module piecemeal. Redis is already global
 * from RedisModule.
 */
@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class ThrottleModule {}
