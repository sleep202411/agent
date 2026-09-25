import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../infra/redis/redis.module';
import type { AuthUser } from './auth.types';

/** Shared across server replicas; update membership without another deploy. */
export const EMERGENCY_BLOCKED_USER_IDS_KEY =
  'security:emergency:blocked-user-ids:v1';

const CHECK_TIMEOUT_MS = 750;

// Incident 2026-09-25: all 935 confirmed bulk registrations have this exact
// shape. Keep this secondary rule during containment so newly registered IDs
// cannot outrun the explicit Redis user-ID blocklist.
const BULK_SIGNUP_EMAIL =
  /^mu[ef][a-z0-9]{9}@(imgfx\.art|imageeditgpt\.com|animateany\.com|theeditai\.com|aniimate\.net|animatimg\.com|ve0ai\.com|wanaivideogenerator\.com)$/i;

export function isEmergencyBulkSignupEmail(email: string | undefined): boolean {
  return BULK_SIGNUP_EMAIL.test(email?.trim() ?? '');
}

@Injectable()
export class EmergencyAccessBlockService {
  private readonly enabled =
    process.env.EMERGENCY_USER_BLOCKLIST_ENABLED === 'true';

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async assertAllowed(user: AuthUser): Promise<void> {
    if (!this.enabled) return;

    if (isEmergencyBulkSignupEmail(user.email)) {
      throw blockedAccount();
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let blocked: number;
    try {
      blocked = await Promise.race([
        this.redis.sismember(EMERGENCY_BLOCKED_USER_IDS_KEY, user.userId),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('blocklist timeout')),
            CHECK_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      // During containment, an unavailable blocklist must not turn into an
      // authentication bypass for cached Java sessions.
      throw new ServiceUnavailableException({
        code: 'ACCOUNT_ACCESS_CHECK_UNAVAILABLE',
        msg: 'Account access check is temporarily unavailable.',
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (blocked === 1) throw blockedAccount();
  }
}

function blockedAccount(): ForbiddenException {
  return new ForbiddenException({
    code: 'ACCOUNT_ACCESS_SUSPENDED',
    msg: 'Account access is temporarily suspended.',
  });
}
