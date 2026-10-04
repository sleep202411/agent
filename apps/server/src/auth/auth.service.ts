import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  get as httpGet,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
} from 'node:http';
import { get as httpsGet } from 'node:https';
import { describeUnknown, isRecord, scalarString } from '../common/values';
import { parseJavaLevelIds } from '../integrations/java/user-level-gates';
import type { AuthSessionContext, AuthUser } from './auth.types';
import { EmergencyAccessBlockService } from './emergency-access-block.service';

type JavaAuthResponse = {
  success?: boolean;
  code?: number | string;
  data?: Record<string, unknown>;
  info?: Record<string, unknown>;
  /** Sibling of `info` — certification level rows for the session user. */
  level?: unknown;
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
 * Future migration path: replace session validation internals with
 * direct Redis sa-token session lookup. The public interface stays
 * the same — all consumers receive an AuthUser.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Positive validation cache keyed by the SHA-256 digest of one credential
   * candidate, never by the browser's complete Cookie header. Cookie ordering
   * and unrelated cookies change frequently and must not push the interactive
   * Agent admission path back through remote Java authentication.
   */
  private cache = new Map<string, { user: AuthUser; expiresAt: number }>();
  /** Coalesces concurrent remote checks for the same credential. */
  private inFlight = new Map<string, Promise<AuthUser | null>>();

  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly CACHE_MAX_SIZE = 1000;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private readonly pendingRequests = new Set<() => void>();

  private async getJson<T extends object>(
    url: string,
    cookie: string,
    label: string,
    timeoutMs = 10_000,
  ): Promise<T | null> {
    if (this.stopping) return null;
    const get: NodeGet = url.startsWith('https') ? httpsGet : httpGet;
    return new Promise<T | null>((resolve) => {
      let settled = false;
      let req: ClientRequest | undefined;
      const finish = (value: T | null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.pendingRequests.delete(cancel);
        resolve(value);
      };
      const cancel = () => {
        finish(null);
        req?.destroy();
      };
      this.pendingRequests.add(cancel);
      // Bound the entire response, including connection and body delivery.
      // Socket inactivity alone permits a trickling response to wait forever.
      const timer = setTimeout(cancel, timeoutMs);
      try {
        req = get(url, { headers: { Cookie: cookie } }, (res) => {
          if (settled) {
            res.destroy();
            return;
          }
          const statusCode = res.statusCode ?? 0;
          res.setEncoding('utf8');
          let data = '';
          res.on('data', (chunk: string) => {
            if (!settled) data += chunk;
          });
          res.on('error', cancel);
          res.on('aborted', cancel);
          res.on('close', () => {
            if (!res.complete) cancel();
          });
          res.on('end', () => {
            if (settled) return;
            if (statusCode !== 200) {
              this.logger.warn(`${label} failed: HTTP ${statusCode}`);
              finish(null);
              return;
            }
            try {
              const parsed: unknown = JSON.parse(data);
              finish(isRecord(parsed) ? (parsed as T) : null);
            } catch {
              this.logger.warn(`${label} returned invalid JSON`);
              finish(null);
            }
          });
        });
        req.on('error', () => finish(null));
      } catch {
        cancel();
      }
    });
  }

  constructor(
    private readonly emergencyAccessBlock: EmergencyAccessBlockService,
  ) {
    // Prune expired entries every 60 seconds
    this.pruneTimer = setInterval(() => this.pruneCache(), 60_000);
  }

  onModuleDestroy() {
    this.stopping = true;
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    for (const cancel of this.pendingRequests) cancel();
    this.cache.clear();
    this.inFlight.clear();
  }

  /**
   * Validate a session cookie and return the authenticated user.
   * Returns null if the token is invalid or expired.
   *
   * Pass `{ bypassCache: true }` when the caller needs a live Java snapshot
   * of mutable fields (e.g. `levelIds` after an admin grants AI 制片人).
   * Re-login works around the same staleness because a new satoken misses
   * the previous cache entry; eligibility / create must not require that.
   */
  async validateToken(
    cookie: string,
    options?: { bypassCache?: boolean },
  ): Promise<AuthUser | null> {
    const session = await this.validateSessionContext(cookie, options);
    return session?.user ?? null;
  }

  /** Keep the authenticated user and selected forwarding credential together. */
  async validateSessionContext(
    cookie: string,
    options?: { bypassCache?: boolean },
  ): Promise<AuthSessionContext | null> {
    if (this.stopping || !cookie) return null;

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
    const candidates: Array<{
      cookie: string;
      cacheKey: string;
      fingerprint: string;
    }> =
      satokenValues.length > 0
        ? satokenValues.map((value) => credentialCandidate(`satoken=${value}`))
        : [credentialCandidate(cookie)];

    const bypassCache = options?.bypassCache === true;

    // Search every candidate before doing I/O. If a stale duplicate appears
    // first, a later known-good token must still keep the request local.
    if (!bypassCache) {
      for (const candidate of candidates) {
        const cached = this.cachedUser(candidate.cacheKey);
        if (cached) {
          await this.emergencyAccessBlock.assertAllowed(cached);
          return { user: cached, cookie: candidate.cookie };
        }
      }
    }

    for (const candidate of candidates) {
      const user = await this.validateCandidate(candidate, bypassCache);
      if (this.stopping) return null;
      if (!user) continue;
      await this.emergencyAccessBlock.assertAllowed(user);
      if (satokenValues.length > 1) {
        this.logger.log(
          `Auth validated via 1 of ${satokenValues.length} satoken candidates (stale-cookie skip) tokenFingerprint=${candidate.fingerprint}`,
        );
      }
      return { user, cookie: candidate.cookie };
    }
    return null;
  }

  private cachedUser(cacheKey: string): AuthUser | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(cacheKey);
      return null;
    }
    // Refresh insertion order so the bounded Map behaves as an LRU cache.
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, cached);
    return cached.user;
  }

  private async validateCandidate(
    candidate: {
      cookie: string;
      cacheKey: string;
      fingerprint: string;
    },
    bypassCache = false,
  ): Promise<AuthUser | null> {
    if (!bypassCache) {
      const cached = this.cachedUser(candidate.cacheKey);
      if (cached) return cached;

      const existing = this.inFlight.get(candidate.cacheKey);
      if (existing) return existing;
    }

    // A forced refresh supersedes cached and pending snapshots for this key.
    // Older requests may finish for their caller, but cannot repopulate cache.
    if (bypassCache) this.cache.delete(candidate.cacheKey);
    const validation = this.validateSatoken(
      candidate.cookie,
      candidate.fingerprint,
    )
      .then((user) => {
        if (this.stopping || !user) return null;
        if (this.inFlight.get(candidate.cacheKey) !== validation) return user;
        while (this.cache.size >= AuthService.CACHE_MAX_SIZE) {
          const oldest = this.cache.keys().next();
          if (oldest.done) break;
          this.cache.delete(oldest.value);
        }
        this.cache.set(candidate.cacheKey, {
          user,
          expiresAt: Date.now() + AuthService.CACHE_TTL_MS,
        });
        return user;
      })
      .finally(() => {
        if (this.inFlight.get(candidate.cacheKey) === validation) {
          this.inFlight.delete(candidate.cacheKey);
        }
      });
    this.inFlight.set(candidate.cacheKey, validation);
    return validation;
  }

  /**
   * Validate ONE `satoken=<value>` cookie against Java and map it to an
   * AuthUser. Returns null on any failure (HTTP error, "not logged in",
   * missing userId). Pure per-token check — caching is the caller's job.
   */
  private async validateSatoken(
    satokenCookie: string,
    fingerprint: string,
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
      this.logger.log(
        `Auth validation request url=${url} tokenFingerprint=${fingerprint}`,
      );
      const body = await this.getJson<JavaAuthResponse>(
        url,
        satokenCookie,
        `Auth validation tokenFingerprint=${fingerprint}`,
      );

      if (!body) return null;

      const isSuccess =
        body.success === true || body.code === 200 || body.code === 'SUCCESS';

      // API returns user info in `info` field (not `data`)
      const data = body.info ?? body.data;
      if (!isSuccess || !data) {
        const msg =
          scalarString(body.msg) ?? scalarString(body.message) ?? 'unknown';
        this.logger.warn(
          `Auth validation rejected: ${msg} tokenFingerprint=${fingerprint}`,
        );
        return null;
      }
      const user: AuthUser = {
        userId: scalarString(data.id) ?? scalarString(data.userId) ?? '',
        userName: scalarString(data.userName),
        nickName: scalarString(data.nickName),
        email: scalarString(data.email),
        phone: scalarString(data.phone),
        headImg: scalarString(data.headImg),
        // `level` is a sibling of `info` on the Java envelope, not nested inside it.
        levelIds: parseJavaLevelIds(body.level),
      };

      if (!user.userId) {
        this.logger.warn(
          `Auth validation: no userId in response tokenFingerprint=${fingerprint}`,
        );
        return null;
      }

      this.logger.log(
        `Auth validated: userId=${user.userId} name=${user.nickName ?? user.userName ?? '?'} tokenFingerprint=${fingerprint}`,
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
    if (this.stopping || !cookie) return null;

    const baseUrl = process.env.JAVA_CONTENT_URL?.replace(/\/$/, '');
    if (!baseUrl) {
      this.logger.error('JAVA_CONTENT_URL not configured');
      return null;
    }

    const satokenMatch = cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
    const satokenCookie = satokenMatch ? `satoken=${satokenMatch[1]}` : cookie;
    const fingerprint = tokenFingerprint(satokenMatch?.[1] ?? cookie);
    const url = `${baseUrl}/user/needAuth`;

    const body = await this.getJson<Record<string, unknown>>(
      url,
      satokenCookie,
      `KYC status tokenFingerprint=${fingerprint}`,
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
    if (
      body.success === false ||
      (body.code !== undefined &&
        ![200, '200', 'SUCCESS'].includes(body.code as string | number)) ||
      (!isSuccess && !('needAuth' in payload))
    ) {
      this.logger.warn(
        `KYC status check rejected: ${
          scalarString(body.msg) ?? scalarString(body.message) ?? 'unknown'
        } tokenFingerprint=${fingerprint}`,
      );
      return null;
    }

    const needAuth = payload.needAuth;
    if (typeof needAuth === 'boolean') return needAuth;
    if (needAuth === 'true') return true;
    if (needAuth === 'false') return false;
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

function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function credentialCandidate(cookie: string): {
  cookie: string;
  cacheKey: string;
  fingerprint: string;
} {
  const cacheKey = createHash('sha256').update(cookie).digest('hex');
  return {
    cookie,
    cacheKey,
    fingerprint: cacheKey.slice(0, 12),
  };
}
