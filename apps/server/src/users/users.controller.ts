/**
 * /users — public-profile BFF over Java's user endpoints.
 *
 * Routes:
 *   GET /aurora/users/lookup?{account|email|phone}=…&checkCrewId=…
 *     Resolve a contact (email/phone) to a profile; crew-member /
 *     founder flags added when checkCrewId is supplied. Used by the
 *     add-member dialog. Rate-limited 30/min per viewer.
 *
 *   GET /aurora/users/by-id?id=<id>
 *     Resolve a single Java user id → safe public projection
 *     ({ userId, nickname, avatar }). Used for one-off owner /
 *     applicant displays. idFormat=public decodes displayed creator IDs.
 *     Rate-limited 60/min per viewer.
 *
 *   GET /aurora/users/by-ids?ids=1,2,3
 *     Batch resolve up to 50 ids in parallel. Used by the crew
 *     workspace member list to fill display names in a single round
 *     trip; the service caches per-id (Redis 5 min) so repeated
 *     screens cost zero upstream calls. Missing ids are omitted from
 *     the response — callers diff against input to know who 404'd.
 *     Rate-limited 30/min per viewer (cost = 1 regardless of |ids|).
 *
 * Auth: required on every route (forwards the viewer's satoken cookie
 * to Java). Returns 502 if Java is unreachable / rejects auth.
 *
 * Cross-user disclosure: every response is filtered to
 * `{ userId, nickname, avatar }` even though Java sends `contact`,
 * `study`, `description` etc. — see UsersService.
 */
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { parsePublicUserId } from '@repo/shared/user-id-codec';
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

  /** Current signed-in user's profile with a final (resolved) avatar URL. */
  @Get('me')
  async me(@ViewerCookie() cookie: string) {
    return this.svc.me(cookie);
  }

  @Get('lookup')
  async lookup(
    @CurrentUser() viewer: AuthUser,
    @ViewerCookie() cookie: string,
    @Query('account') account?: string,
    @Query('email') email?: string,
    @Query('phone') phone?: string,
    @Query('checkCrewId') checkCrewId?: string,
  ) {
    for (const [field, value] of Object.entries({
      account,
      email,
      phone,
      checkCrewId,
    })) {
      assertScalarQuery(value, field);
    }
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

  @Get('by-id')
  async byId(
    @CurrentUser() viewer: AuthUser,
    @ViewerCookie() cookie: string,
    @Query('id') id?: string,
    @Query('checkCrewId') checkCrewId?: string,
    @Query('idFormat') idFormat?: string,
  ) {
    assertScalarQuery(checkCrewId, 'checkCrewId');
    assertScalarQuery(id, 'id');
    assertScalarQuery(idFormat, 'idFormat');
    if (idFormat !== undefined && idFormat !== 'raw' && idFormat !== 'public') {
      throw new BadRequestException({ message: 'Invalid idFormat' });
    }
    const trimmed = (id ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException({ message: 'id required' });
    }
    const rawId = idFormat === 'public' ? parsePublicUserId(trimmed) : trimmed;
    if (!rawId || !/^\d{1,18}$/.test(rawId)) {
      throw new BadRequestException({
        message: 'id must be a positive integer',
      });
    }
    await this.rateLimit.guard({
      bucket: 'user-by-id',
      actorId: viewer.userId,
      max: 60,
      windowSec: 60,
    });
    const result = await this.svc.lookupByUserId(rawId, cookie, checkCrewId);
    if (!result) {
      throw new NotFoundException({ message: 'No user with that id' });
    }
    return result;
  }

  @Get('by-ids')
  async byIds(
    @CurrentUser() viewer: AuthUser,
    @ViewerCookie() cookie: string,
    @Query('ids') ids?: string,
  ) {
    assertScalarQuery(ids, 'ids');
    const raw = (ids ?? '').trim();
    if (!raw) {
      return { users: [] };
    }
    const parsed = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{1,18}$/.test(s));
    // Cap fan-out so a single request can't fire 1000 upstream calls.
    // 50 covers any plausible crew (typical 5-20 members) and keeps
    // the worst-case latency bounded while Java has no native batch.
    if (parsed.length > 50) {
      throw new BadRequestException({
        message: 'Too many ids (max 50 per request)',
      });
    }
    if (parsed.length === 0) {
      return { users: [] };
    }
    await this.rateLimit.guard({
      bucket: 'user-by-ids',
      actorId: viewer.userId,
      max: 30,
      windowSec: 60,
    });
    const users = await this.svc.lookupByUserIds(parsed, cookie);
    return { users };
  }
}

function assertScalarQuery(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new BadRequestException({
      message: `${field} must be a single string`,
      field,
    });
  }
}
