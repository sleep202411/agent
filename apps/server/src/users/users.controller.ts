/**
 * /users/lookup — single endpoint, today resolves a userId via Java.
 *
 *   GET /aurora/users/lookup?userId=13178[&checkCrewId=<cuid>]
 *
 * Auth: required.
 * Rate limit: 30 per minute per logged-in user.
 * Returns:
 *   200 LookupUserDTO — found
 *   404 — not found
 *   400 — userId missing / invalid
 *   429 — rate limit
 *   502 — upstream Java unavailable
 *
 * When Java ships email/phone resolution, add `email` / `phone` query
 * params here and dispatch to the appropriate JavaUserLookupService
 * method — no consumer migration needed; this endpoint stays the only
 * web-facing surface.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { RateLimitService } from '../common/throttle/rate-limit.service';
import { UsersService } from './users.service';

// Java userIds are numeric strings today; accept a generous superset
// (alphanumeric + dash/underscore, ≤32 chars) so we don't have to
// re-validate when the format evolves.
const USER_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d[\d\s-]{5,32}$/;

const LookupBatchSchema = z.object({
  userIds: z.array(z.string().trim().regex(USER_ID_RE)).max(100),
  checkCrewId: z.string().trim().optional(),
});
type LookupBatchInput = z.infer<typeof LookupBatchSchema>;

@Controller('users')
export class UsersController {
  constructor(
    private readonly svc: UsersService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * Lookup endpoint with three input modes (mutually exclusive):
   *   ?userId=...   → resolve by internal Java userId
   *   ?account=...  → resolve by email OR phone (Java's "account")
   *   ?email=...    → alias of `account` for client clarity
   *   ?phone=...    → alias of `account` for client clarity
   *
   * Email / phone share the same Java endpoint (account is the
   * Java field name), so we collapse all three into one resolution
   * path server-side. Exactly one of the four must be supplied.
   */
  @Get('lookup')
  async lookup(
    @CurrentUser() viewer: AuthUser,
    @Query('userId') userId?: string,
    @Query('account') account?: string,
    @Query('email') email?: string,
    @Query('phone') phone?: string,
    @Query('checkCrewId') checkCrewId?: string,
  ) {
    const userIdT = userId?.trim() || undefined;
    const accountT = (account ?? email ?? phone)?.trim() || undefined;
    const supplied = [userIdT, accountT].filter(Boolean).length;
    if (supplied === 0) {
      throw new BadRequestException({
        message: 'Provide userId, account, email, or phone',
      });
    }
    if (supplied > 1) {
      throw new BadRequestException({
        message: 'Provide only one of userId / account / email / phone',
      });
    }

    if (userIdT && !USER_ID_RE.test(userIdT)) {
      throw new BadRequestException({
        message: 'Invalid userId format',
        field: 'userId',
      });
    }
    if (accountT && !EMAIL_RE.test(accountT) && !PHONE_RE.test(accountT)) {
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

    const result = userIdT
      ? await this.svc.lookup({ userId: userIdT, checkCrewId })
      : await this.svc.lookupByContact({ account: accountT!, checkCrewId });

    if (!result) {
      throw new NotFoundException({ message: 'No user matches that input' });
    }
    return result;
  }

  /**
   * Batch lookup. Returns a map keyed by userId; missing / failed
   * resolutions are `null` so the client can render a placeholder
   * for that row instead of an exception. Counts as ONE rate-limit
   * unit regardless of fan-out (the unit cap is twice the per-call
   * cap to keep dashboards responsive when many distinct rosters
   * load in quick succession).
   */
  @Post('lookup-batch')
  @HttpCode(200)
  async lookupBatch(@CurrentUser() viewer: AuthUser, @Body() body: unknown) {
    const parsed: LookupBatchInput = LookupBatchSchema.parse(body ?? {});
    await this.rateLimit.guard({
      bucket: 'user-lookup-batch',
      actorId: viewer.userId,
      max: 60,
      windowSec: 60,
    });
    return this.svc.lookupBatch(parsed.userIds, parsed.checkCrewId);
  }
}
