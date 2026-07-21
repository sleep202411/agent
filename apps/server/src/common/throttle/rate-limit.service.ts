/**
 * Lightweight per-user sliding-window rate limiter backed by Redis.
 *
 * Stateless wrapper around `INCR + EXPIRE`. Bucket key includes the
 * current window so we never need to manually evict — Redis TTL drops
 * the row when the window rolls over.
 *
 * Usage:
 *   await rateLimit.guard({ bucket: 'user-lookup', userId, max: 30, windowSec: 60 });
 *   // throws HttpException 429 if exceeded
 *
 * Why per-user not per-IP: production traffic is mostly behind
 * Cloudflare / proxies that share IPs; userId from satoken is the
 * actually-meaningful actor.
 */
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module';

export interface RateLimitArgs {
  /** Bucket name — e.g. "user-lookup". Different buckets count independently. */
  bucket: string;
  /** Actor id (user id from satoken, IP, etc). */
  actorId: string;
  /** Max events per window. */
  max: number;
  /** Window length in seconds. */
  windowSec: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Increment + check. Throws 429 if `args.actorId` has exceeded
   * `args.max` events in the current `args.windowSec` window. Returns
   * the remaining quota for the current window when allowed.
   */
  async guard(
    args: RateLimitArgs,
  ): Promise<{ remaining: number; resetInSec: number }> {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % args.windowSec);
    const key = `ratelimit:${args.bucket}:${args.actorId}:${windowStart}`;

    let count: number;
    try {
      count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, args.windowSec + 5);
    } catch (err) {
      // Fail-open on Redis errors: rate limit is a defense-in-depth
      // measure, not the primary access control. Better to serve
      // requests than to lock everyone out when Redis blips.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`rate-limit redis error (failing open): ${msg}`);
      return { remaining: args.max, resetInSec: args.windowSec };
    }

    const remaining = Math.max(0, args.max - count);
    const resetInSec = windowStart + args.windowSec - now;
    if (count > args.max) {
      // The guard runs before the handler, so a rejected request provably never
      // touched anything downstream. Saying so on the wire (`code` + `retryable`,
      // the same shape every other throttled answer uses) is what lets a client
      // wait and repeat instead of assuming its request half-landed.
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          retryable: true,
          retryAfterSec: resetInSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return { remaining, resetInSec };
  }
}
