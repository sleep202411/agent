/**
 * UsersService — composition for the user-lookup BFF.
 *
 * Combines:
 *   - Java profile lookup by userId
 *   - Optional crew-membership enrichment (when `checkCrewId` passed)
 *
 * Caching:
 *   - Profile: Redis 5 min TTL by userId. Cheap to be slightly stale
 *     (display name / avatar).
 *   - Membership check: NOT cached — owner just added/removed someone,
 *     the dialog needs the truth.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { LookupUserDTO } from '@repo/shared/users';
import { PrismaService } from '../infra/db/db.module';
import { REDIS } from '../infra/redis/redis.module';
import { JavaUserLookupService } from '../integrations/java/user-lookup.service';

const LOOKUP_CACHE_TTL_SEC = 5 * 60;

export interface LookupRequest {
  userId: string;
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

  async lookup(req: LookupRequest): Promise<LookupUserDTO | null> {
    const cacheKey = `user-lookup:byId:${req.userId}`;

    let raw = await this.tryReadCache(cacheKey);
    if (!raw) {
      raw = await this.javaLookup.findByUserId(req.userId);
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
