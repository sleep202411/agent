import { Injectable, Logger } from '@nestjs/common';
import {
  get as httpGet,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
} from 'node:http';
import { get as httpsGet } from 'node:https';
import { describeUnknown, isRecord, scalarString } from '../common/values';
import type { AuthUser } from './auth.types';

type JavaAuthResponse = {
  success?: boolean;
  code?: number | string;
  data?: Record<string, unknown>;
  info?: Record<string, unknown>;
  msg?: unknown;
  message?: unknown;
};

type NodeGet = (
  url: string | URL,
  options: RequestOptions,
  callback: (res: IncomingMessage) => void,
) => ClientRequest;

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

  private async getJson<T extends object>(
    url: string,
    cookie: string,
    label: string,
    timeoutMs = 10_000,
  ): Promise<T | null> {
    const get: NodeGet = url.startsWith('https') ? httpsGet : httpGet;
    return new Promise<T | null>((resolve) => {
      const req = get(
        url,
        {
          headers: { Cookie: cookie },
        },
        (res) => {
          const statusCode = res.statusCode ?? 0;
          res.setEncoding('utf8');
          let data = '';
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => {
            if (statusCode !== 200) {
              this.logger.warn(
                `${label} failed: HTTP ${statusCode} body=${data.slice(0, 200)}`,
              );
              resolve(null);
              return;
            }
            try {
              const parsed: unknown = JSON.parse(data);
              resolve(isRecord(parsed) ? (parsed as T) : null);
            } catch {
              this.logger.warn(`${label} returned invalid JSON`);
              resolve(null);
            }
          });
        },
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`${label} request timed out`));
      });
      req.on('error', (err: Error) => {
        this.logger.error(`${label} request error: ${err.message}`);
        resolve(null);
      });
    });
  }

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
      // Use https module instead of fetch — Node.js undici fetch
      // does not reliably forward cookie headers in all environments.
      const url = `${baseUrl}/user/query/user/info`;
      this.logger.log(`Auth validation request url=${url} token=${tokenHint}`);
      const body = await this.getJson<JavaAuthResponse>(
        url,
        satokenCookie,
        `Auth validation token=${tokenHint}`,
      );

      if (!body) return null;

      const isSuccess =
        body.success === true || body.code === 200 || body.code === 'SUCCESS';

      // API returns user info in `info` field (not `data`)
      const data = body.info ?? body.data;
      if (!isSuccess || !data) {
        const msg =
          scalarString(body.msg) ?? scalarString(body.message) ?? 'unknown';
        this.logger.warn(`Auth validation rejected: ${msg} token=${tokenHint}`);
        return null;
      }
      const user: AuthUser = {
        userId: scalarString(data.id) ?? scalarString(data.userId) ?? '',
        userName: scalarString(data.userName),
        nickName: scalarString(data.nickName),
        email: scalarString(data.email),
        phone: scalarString(data.phone),
        headImg: scalarString(data.headImg),
        userLevel: scalarString(data.userLevel)?.toUpperCase(),
        expireTime: scalarString(data.expireTime),
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
        const first = this.cache.keys().next();
        if (!first.done) this.cache.delete(first.value);
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
      this.logger.error(`Auth validation error: ${describeUnknown(error)}`);
      return null;
    }
  }

  /**
   * CN compliance gate: Java owns real-name verification state.
   *
   * Returns:
   *   - true  → user still needs KYC
   *   - false → user is cleared for KYC-gated actions
   *   - null  → status could not be verified
   */
  async needsRealNameVerification(cookie: string): Promise<boolean | null> {
    if (!cookie) return null;

    const baseUrl = process.env.JAVA_CONTENT_URL?.replace(/\/$/, '');
    if (!baseUrl) {
      this.logger.error('JAVA_CONTENT_URL not configured');
      return null;
    }

    const satokenMatch = cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
    const satokenCookie = satokenMatch ? `satoken=${satokenMatch[1]}` : cookie;
    const tokenHint = satokenMatch?.[1].slice(0, 8) ?? '(none)';
    const url = `${baseUrl}/user/needAuth`;

    const body = await this.getJson<Record<string, unknown>>(
      url,
      satokenCookie,
      `KYC status token=${tokenHint}`,
      5000,
    );

    if (!body) return null;

    const isSuccess =
      body.success === true || body.code === 200 || body.code === 'SUCCESS';
    const payload =
      typeof body.data === 'object' && body.data !== null
        ? (body.data as Record<string, unknown>)
        : typeof body.info === 'object' && body.info !== null
          ? (body.info as Record<string, unknown>)
          : body;
    if (!isSuccess && !('needAuth' in payload)) {
      this.logger.warn(
        `KYC status check rejected: ${
          scalarString(body.msg) ?? scalarString(body.message) ?? 'unknown'
        } token=${tokenHint}`,
      );
      return null;
    }

    const needAuth = payload.needAuth;
    if (typeof needAuth === 'boolean') return needAuth;
    if (typeof needAuth === 'string') return needAuth === 'true';
    return null;
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
