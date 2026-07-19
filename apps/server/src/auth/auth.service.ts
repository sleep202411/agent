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

    // Check cache first (keyed by the full incoming cookie header).
    const cached = this.cache.get(cookie);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    // A browser can carry MULTIPLE `satoken` cookies for fizzdragon.com — the
    // fresh one from the current login PLUS a stale host-only one left over
    // from the legacy iframe/uni-app flow. Header order isn't reliable, so we
    // can't assume the first one is the live session: validate EACH distinct
    // satoken against Java and accept the first that resolves a user. (The WS
    // gateways sidestep this via an explicit query satoken; the HTTP path has
    // no such hint, hence try-each.) Falls back to the whole cookie when there
    // is no satoken at all (token carried under a different name).
    const satokenValues = [
      ...new Set(
        [...cookie.matchAll(/(?:^|;\s*)satoken=([^;]+)/g)].map((m) => m[1]),
      ),
    ];
    const candidates: Array<{ cookie: string; hint: string }> =
      satokenValues.length > 0
        ? satokenValues.map((value) => ({
            cookie: `satoken=${value}`,
            hint: value.slice(0, 8),
          }))
        : [{ cookie, hint: '(none)' }];

    for (const candidate of candidates) {
      const user = await this.validateSatoken(candidate.cookie, candidate.hint);
      if (!user) continue;
      // Evict oldest if cache is full
      if (this.cache.size >= AuthService.CACHE_MAX_SIZE) {
        const first = this.cache.keys().next();
        if (!first.done) this.cache.delete(first.value);
      }
      this.cache.set(cookie, {
        user,
        expiresAt: Date.now() + AuthService.CACHE_TTL_MS,
      });
      if (satokenValues.length > 1) {
        this.logger.log(
          `Auth validated via 1 of ${satokenValues.length} satoken candidates (stale-cookie skip) token=${candidate.hint}`,
        );
      }
      return user;
    }
    return null;
  }

  /**
   * Validate ONE `satoken=<value>` cookie against Java and map it to an
   * AuthUser. Returns null on any failure (HTTP error, "not logged in",
   * missing userId). Pure per-token check — caching is the caller's job.
   */
  private async validateSatoken(
    satokenCookie: string,
    tokenHint: string,
  ): Promise<AuthUser | null> {
    try {
      const baseUrl = process.env.JAVA_CONTENT_URL?.replace(/\/$/, '');
      if (!baseUrl) {
        this.logger.error('JAVA_CONTENT_URL not configured');
        return null;
      }
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
      };

      if (!user.userId) {
        this.logger.warn(
          `Auth validation: no userId in response token=${tokenHint}`,
        );
        return null;
      }

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
