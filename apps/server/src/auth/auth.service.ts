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
  private static readonly CACHE_MAX_SIZE = 1000;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Prune expired entries every 60 seconds
    this.pruneTimer = setInterval(() => this.pruneCache(), 60_000);
  }

  onModuleDestroy() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }

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

      // Extract only the satoken cookie — Java chokes on unrelated cookies
      const satokenMatch = cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
      const satokenCookie = satokenMatch
        ? `satoken=${satokenMatch[1]}`
        : cookie;
      const tokenHint = satokenMatch?.[1].slice(0, 8) ?? '(none)';
      // TEMP DIAGNOSTIC — dump full satoken values + count duplicates so we can
      // tell apart "Cookie header has multiple satoken= entries" from "Java
      // doesn't recognize the only token sent". Remove once root cause found.
      const allSatokens = (
        cookie.match(/(?:^|;\s*)satoken=([^;]+)/g) ?? []
      ).map((s: string) => s.replace(/^[;\s]*satoken=/, ''));
      this.logger.log(
        `[diag] satoken-count=${allSatokens.length} sending=${satokenMatch?.[1] ?? '(none)'} all=${JSON.stringify(allSatokens)}`,
      );

      // Use https module instead of fetch — Node.js undici fetch
      // does not reliably forward cookie headers in all environments.
      const url = `${baseUrl}/user/query/user/info`;
      // TEMP DIAGNOSTIC — print full outbound request so we can compare
      // against the working `node -e https.get(...)` repro from the shell.
      this.logger.log(
        `[diag] outbound GET ${url} headers=${JSON.stringify({ Cookie: satokenCookie })}`,
      );
      const body = await new Promise<{
        success?: boolean;
        code?: number | string;
        data?: Record<string, unknown>;
        info?: Record<string, unknown>;
        msg?: string;
        message?: string;
      } | null>((resolve) => {
        const https = require('https');
        const http = require('http');
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(
          url,
          {
            headers: { Cookie: satokenCookie },
          },
          (res: { statusCode: number; on: Function }) => {
            this.logger.log(
              `[diag] inbound status=${res.statusCode} from ${url}`,
            );
            if (res.statusCode !== 200) {
              let errData = '';
              res.on('data', (c: string) => (errData += c));
              res.on('end', () => {
                this.logger.warn(
                  `Auth validation failed: HTTP ${res.statusCode} token=${tokenHint} url=${url} body=${errData.slice(0, 200)}`,
                );
                resolve(null);
              });
              return;
            }
            let data = '';
            res.on('data', (chunk: string) => (data += chunk));
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve(null);
              }
            });
          },
        );
        req.on('error', (err: Error) => {
          this.logger.error(`Auth request error: ${err.message}`);
          resolve(null);
        });
      });

      if (!body) return null;

      const isSuccess =
        body.success === true || body.code === 200 || body.code === 'SUCCESS';

      // API returns user info in `info` field (not `data`)
      const data = body.info ?? body.data;
      if (!isSuccess || !data) {
        const msg = body.msg || body.message || 'unknown';
        this.logger.warn(`Auth validation rejected: ${msg} token=${tokenHint}`);
        return null;
      }
      const user: AuthUser = {
        userId: String(data.id ?? data.userId ?? ''),
        userName: (data.userName as string) ?? undefined,
        nickName: (data.nickName as string) ?? undefined,
        email: (data.email as string) ?? undefined,
        phone: (data.phone as string) ?? undefined,
        headImg: (data.headImg as string) ?? undefined,
        userLevel: data.userLevel
          ? String(data.userLevel).toUpperCase()
          : undefined,
      };

      if (!user.userId) {
        this.logger.warn(
          `Auth validation: no userId in response token=${tokenHint}`,
        );
        return null;
      }

      // Cache the result
      // Evict oldest if cache is full
      if (this.cache.size >= AuthService.CACHE_MAX_SIZE) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }
      this.cache.set(cookie, {
        user,
        expiresAt: Date.now() + AuthService.CACHE_TTL_MS,
      });

      this.logger.log(
        `Auth validated: userId=${user.userId} name=${user.nickName ?? user.userName ?? '?'} token=${tokenHint}`,
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
