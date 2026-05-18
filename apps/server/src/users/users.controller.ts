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
  Controller,
  Get,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { RateLimitService } from '../common/throttle/rate-limit.service';
import { UsersService } from './users.service';

// Java userIds are numeric strings today; accept a generous superset
// (alphanumeric + dash/underscore, ≤32 chars) so we don't have to
// re-validate when the format evolves.
const USER_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

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
}
