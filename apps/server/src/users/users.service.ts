/**
 * UsersService — composition for the user-lookup BFF.
 *
 * Two read paths:
 *   - lookupByContact(account, cookie, checkCrewId?) — by email/phone,
 *     enriched with crew-membership context.
 *   - lookupByUserId(id, cookie) / lookupByUserIds(ids, cookie) — direct
 *     by Java user id. Only returns `{ userId, nickname, avatar }`
 *     (no contact/study/description even though Java sends them).
 *     Used by the crew workspace to resolve members → display names.
 *
 * Caching:
 *   - Positive contact lookups: Redis 5 min TTL keyed on
 *     sha256(normalized account). Slightly stale nickname/avatar is fine.
 *   - Positive by-id lookups: Redis 5 min TTL keyed on userId.
 *   - Negative lookups NOT cached — caching "no such email/id" would
 *     let an attacker enumerate via fast Redis-hit timing.
 *   - Membership check: NOT cached — owner adds/removes shift truth.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { resolveUserAvatar } from './avatar';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import type { LookupUserDTO } from '@repo/shared/users';
import { PrismaService } from '../infra/db/db.module';
import { REDIS } from '../infra/redis/redis.module';
import { JavaUserLookupService } from '../integrations/java/user-lookup.service';

const LOOKUP_CACHE_TTL_SEC = 5 * 60;

export interface LookupByContactRequest {
  account: string;
  /** Viewer's raw cookie — forwarded to Java for sa-token auth. */
  cookie: string;
  /** If supplied, response includes isCrewMember + isCrewFounder. */
  checkCrewId?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly javaLookup: JavaUserLookupService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * The CURRENT user's profile for the studio shell: proxies Java
   * `/user/query/user/info` (cookie-forwarded) and resolves the avatar to a
   * final, ready-to-use URL (custom image, else a deterministic DiceBear face)
   * so clients don't each re-implement host-prefixing + the fallback. Null when
   * not logged in.
   */
  async me(cookie: string): Promise<{
    id: string;
    nickName: string | null;
    email: string | null;
    phone: string | null;
    avatar: string;
  } | null> {
    const info = await this.javaLookup.findCurrentUser(cookie);
    if (!info || info.id == null) {
      // Mirror the AuthGuard's dev fallback (auth.guard.ts DEV_USER): with
      // auth disabled locally, surface the same 'dev' identity to the client
      // so signed-in surfaces develop against the local database.
      if (process.env.AUTH_DISABLED === 'true') {
        return {
          id: 'dev',
          nickName: 'dev',
          email: null,
          phone: null,
          avatar: await resolveUserAvatar(null, 'dev'),
        };
      }
      return null;
    }
    const str = (v: unknown): string | null =>
      typeof v === 'string' && v.trim()
        ? v
        : typeof v === 'number'
          ? String(v)
          : null;
    const rawAvatar =
      (typeof info.headImg === 'string' ? info.headImg : null) ??
      (typeof info.avatar === 'string' ? info.avatar : null);
    return {
      id: String(info.id),
      nickName: str(info.nickName) ?? str(info.userName) ?? str(info.name),
      email: str(info.email),
      phone: str(info.phone),
      avatar: await resolveUserAvatar(rawAvatar, String(info.id)),
    };
  }

  /**
   * Look up a single user by their Java user id. Returns the safe
   * public projection (`isCrewMember`/`isCrewFounder` always null —
   * by-id lookups don't carry a crew context). Null on not-found.
   */
  async lookupByUserId(
    userId: string,
    cookie: string,
  ): Promise<LookupUserDTO | null> {
    const trimmed = userId.trim();
    if (!trimmed) return null;
    const cacheKey = `user-lookup:byId:${trimmed}`;

    let raw = await this.tryReadCache(cacheKey);
    if (!raw) {
      raw = await this.javaLookup.findByUserId(trimmed, cookie);
      if (!raw) return null;
      await this.writeCache(cacheKey, raw);
    }
    return {
      userId: raw.userId,
      nickname: raw.nickname,
      avatar: raw.avatar,
      isCrewMember: null,
      isCrewFounder: null,
    };
  }

  /**
   * Batch variant — parallel fan-out, single-id cache reuse. Java has
   * no native batch endpoint, so each id costs one upstream call (or
   * zero on cache hit). De-dupes ids before fan-out so a crew with the
   * same user listed twice doesn't fire two requests. Returns one
   * entry per FOUND id; missing ids are omitted (no `null` placeholders
   * in the array — caller can diff against input to know which 404'd).
   */
  async lookupByUserIds(
    userIds: readonly string[],
    cookie: string,
  ): Promise<LookupUserDTO[]> {
    const uniq = Array.from(
      new Set(userIds.map((id) => id?.trim()).filter((id) => !!id)),
    );
    if (uniq.length === 0) return [];
    const settled = await Promise.allSettled(
      uniq.map((id) => this.lookupByUserId(id, cookie)),
    );
    const out: LookupUserDTO[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) out.push(r.value);
      // Rejected → individual upstream failure; swallow so a single bad
      // id doesn't take down the whole batch. The successful ids still
      // come back, and the missing ones look like "not found" to the
      // client (good enough for a display-name lookup).
    }
    return out;
  }

  async lookupByContact(
    req: LookupByContactRequest,
  ): Promise<LookupUserDTO | null> {
    const normalized = req.account.includes('@')
      ? req.account.trim().toLowerCase()
      : req.account.trim();
    const cacheKey = `user-lookup:byAcct:${hashAccount(normalized)}`;

    let raw = await this.tryReadCache(cacheKey);
    if (!raw) {
      raw = await this.javaLookup.findByContact(normalized, req.cookie);
      if (!raw) return null;
      await this.writeCache(cacheKey, raw);
    }

    return this.enrichWithCrewContext(raw, req.checkCrewId);
  }

  private async enrichWithCrewContext(
    raw: { userId: string; nickname: string; avatar: string | null },
    checkCrewId?: string,
  ): Promise<LookupUserDTO> {
    let isCrewMember: boolean | null = null;
    let isCrewFounder: boolean | null = null;
    if (checkCrewId) {
      const [crew, member] = await Promise.all([
        this.prisma.crew.findFirst({
          where: { id: checkCrewId, deletedAt: null },
          select: { founderId: true },
        }),
        this.prisma.crewMember.findFirst({
          where: { crewId: checkCrewId, userId: raw.userId, removedAt: null },
          select: { id: true },
        }),
      ]);
      if (crew) {
        isCrewMember = member != null;
        isCrewFounder = crew.founderId === raw.userId;
      }
    }
    return {
      userId: raw.userId,
      nickname: raw.nickname,
      avatar: raw.avatar,
      isCrewMember,
      isCrewFounder,
    };
  }

  // ─── Cache helpers ─────────────────────────────────────

  private async tryReadCache(key: string) {
    try {
      const v = await this.redis.get(key);
      if (!v) return null;
      return JSON.parse(v) as {
        userId: string;
        nickname: string;
        avatar: string | null;
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`lookup cache read failed: ${msg}`);
      return null;
    }
  }

  private async writeCache(
    key: string,
    raw: { userId: string; nickname: string; avatar: string | null },
  ) {
    try {
      await this.redis.setex(key, LOOKUP_CACHE_TTL_SEC, JSON.stringify(raw));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`lookup cache write failed: ${msg}`);
    }
  }
}

/** Opaque hash of an email/phone for Redis keying — see lookupByContact. */
function hashAccount(account: string): string {
  return createHash('sha256').update(account).digest('hex').slice(0, 16);
}
