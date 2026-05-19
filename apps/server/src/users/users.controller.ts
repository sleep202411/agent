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

  @Get('lookup')
  async lookup(
    @CurrentUser() viewer: AuthUser,
    @Query('userId') userId?: string,
    @Query('checkCrewId') checkCrewId?: string,
  ) {
    const trimmed = userId?.trim() || undefined;
    if (!trimmed) {
      throw new BadRequestException({ message: 'userId is required' });
    }
    if (!USER_ID_RE.test(trimmed)) {
      throw new BadRequestException({
        message: 'Invalid userId format',
        field: 'userId',
      });
    }

    await this.rateLimit.guard({
      bucket: 'user-lookup',
      actorId: viewer.userId,
      max: 30,
      windowSec: 60,
    });

    const result = await this.svc.lookup({ userId: trimmed, checkCrewId });
    if (!result) {
      throw new NotFoundException({ message: 'No user matches that ID' });
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
