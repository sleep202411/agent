import { Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from './auth.types';

/**
 * AuthService — validates session tokens and returns user info.
 *
 * Current implementation: calls Java backend `/user/query/user/info`
 * with the client's cookie to validate the session.
 *
 * Future migration path: replace validateToken() internals with
 * direct Redis sa-token session lookup. The public interface stays
 * the same — all consumers receive an AuthUser.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** In-memory cache: cookie → { user, expiresAt } */
  private cache = new Map<string, { user: AuthUser; expiresAt: number }>();

  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Validate a session cookie and return the authenticated user.
   * Returns null if the token is invalid or expired.
   */
  async validateToken(cookie: string): Promise<AuthUser | null> {
    if (!cookie) return null;

    // Check cache first
    const cached = this.cache.get(cookie);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    try {
      const baseUrl = process.env.JAVA_CONTENT_URL?.replace(/\/$/, '');
      if (!baseUrl) {
        this.logger.error('JAVA_CONTENT_URL not configured');
        return null;
      }

      const response = await fetch(`${baseUrl}/content/user/query/user/info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie,
        },
      });

      if (!response.ok) {
        this.logger.warn(`Auth validation failed: HTTP ${response.status}`);
        return null;
      }

      const body = (await response.json()) as {
        success?: boolean;
        code?: number | string;
        data?: Record<string, unknown>;
        info?: Record<string, unknown>;
        msg?: string;
        message?: string;
      };

      const isSuccess =
        body.success === true || body.code === 200 || body.code === 'SUCCESS';

      // API returns user info in `info` field (not `data`)
      const data = body.info ?? body.data;
      if (!isSuccess || !data) {
        const msg = body.msg || body.message || 'unknown';
        this.logger.warn(`Auth validation rejected: ${msg}`);
        return null;
      }
      const user: AuthUser = {
        userId: String(data.id ?? data.userId ?? ''),
        userName: (data.userName as string) ?? undefined,
        nickName: (data.nickName as string) ?? undefined,
        email: (data.email as string) ?? undefined,
        phone: (data.phone as string) ?? undefined,
        headImg: (data.headImg as string) ?? undefined,
        userLevel: (data.userLevel as string) ?? undefined,
      };

      if (!user.userId) {
        this.logger.warn('Auth validation: no userId in response');
        return null;
      }

      // Cache the result
      this.cache.set(cookie, {
        user,
        expiresAt: Date.now() + AuthService.CACHE_TTL_MS,
      });

      this.logger.log(
        `Auth validated: userId=${user.userId} name=${user.nickName ?? user.userName ?? '?'}`,
      );
      return user;
    } catch (error) {
      this.logger.error(
        `Auth validation error: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * Evict expired entries. Called periodically or on demand.
   */
  pruneCache() {
    const now = Date.now();
    for (const [key, val] of this.cache) {
      if (val.expiresAt <= now) this.cache.delete(key);
    }
  }
}
