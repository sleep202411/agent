/**
 * /users/lookup — resolve email / phone to a user profile (by-contact).
 *
 *   GET /aurora/users/lookup?account=…&checkCrewId=…
 *   GET /aurora/users/lookup?email=…
 *   GET /aurora/users/lookup?phone=…
 *
 * Exactly one of account / email / phone must be supplied (the three
 * are aliases — Java's "account" is the canonical field, but the
 * client-side dialog uses email / phone for clarity).
 *
 * Auth: required (forwards viewer's cookie to Java sa-token).
 * Rate limit: 30 per minute per logged-in user.
 *
 * Returns:
 *   200 LookupUserDTO — found
 *   404 — not found
 *   400 — missing / invalid input
 *   429 — rate limit
 *   502 — upstream Java unavailable / unauthorised
 *
 * No by-userId variant: Java doesn't expose a profile-by-id endpoint;
 * `/user/resumer/list/:id` returns resume entries, not profile.
 * Member-list name resolution falls back to "User <id>" until the
 * by-id endpoint lands.
 */
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { CurrentUser, ViewerCookie } from '../auth';
import type { AuthUser } from '../auth';
import { RateLimitService } from '../common/throttle/rate-limit.service';
import { UsersService } from './users.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d[\d\s-]{5,32}$/;

@Controller('users')
export class UsersController {
  constructor(
    private readonly svc: UsersService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('lookup')
  async lookup(
    @CurrentUser() viewer: AuthUser,
    @ViewerCookie() cookie: string,
    @Query('account') account?: string,
    @Query('email') email?: string,
    @Query('phone') phone?: string,
    @Query('checkCrewId') checkCrewId?: string,
  ) {
    const accountT = (account ?? email ?? phone)?.trim() || undefined;
    if (!accountT) {
      throw new BadRequestException({
        message: 'Provide account, email, or phone',
      });
    }
    if (!EMAIL_RE.test(accountT) && !PHONE_RE.test(accountT)) {
      throw new BadRequestException({
        message: 'Invalid email / phone format',
        field: account != null ? 'account' : email != null ? 'email' : 'phone',
      });
    }

    await this.rateLimit.guard({
      bucket: 'user-lookup',
      actorId: viewer.userId,
      max: 30,
      windowSec: 60,
    });

    const result = await this.svc.lookupByContact({
      account: accountT,
      cookie,
      checkCrewId,
    });
    if (!result) {
      throw new NotFoundException({ message: 'No user matches that input' });
    }
    return result;
  }
}
