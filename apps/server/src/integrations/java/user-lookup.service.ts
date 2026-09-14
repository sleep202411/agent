/**
 * Java user-lookup adapter — two paths:
 *
 *   findByContact(account, cookie) → POST /user/query/user?account=…&pwd=…
 *   findByUserId(userId, cookie)   → POST /user/other/user/info?UserId=…
 *
 * Both forward the viewer's cookie (sa-token) and respond with the
 * Java `{ code, msg, info: { id, nickName, avatar, … } }` envelope.
 * Cross-user (by-id) path was empirically verified 2026-05-20 and
 * lifted out of "no public profile-by-id endpoint" into first-class
 * support — the `/user/resumer/list/:id` claim in the previous
 * comment was about a different endpoint that returns resume rows.
 *
 * Failure modes:
 *   - Found              → RawLookupResult
 *   - Not found          → null
 *   - Java down / unauth → ServiceUnavailableException (mapped to 502)
 *
 * Quirk: `/user/other/user/info` answers **HTTP 500** for unknown
 * userIds (Java NPE on empty result, not 404). We treat HTTP 500 on
 * THIS endpoint as not-found rather than upstream failure, since the
 * Java handler is otherwise stable.
 *
 * Security: the shared `pwd`, viewer cookies, and contact PII never
 * land in logs — `safeUrl` strips `pwd`, and we surface only
 * `{ userId, nickname, avatar }` to BFF callers (skipping the
 * `contact` / `study` / `description` fields Java returns).
 */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  JAVA_CONTENT_URL,
  JAVA_REQUEST_TIMEOUT_MS,
  JAVA_USER_QUERY_PWD,
} from './java-config';

/**
 * Java endpoint that resolves an email OR phone to a user profile.
 * Guarded by the shared `pwd` query param AND a logged-in satoken
 * (sa-token interceptor); we forward both. POST with no body —
 * params on the URL, per Java's contract.
 *
 *   POST {JAVA_CONTENT_URL}/user/query/user?account=…&pwd=…
 *   response: {
 *     code: 200,
 *     msg: "Success",
 *     info: { id: number, nickName?: string, avatar?: string, … }
 *   }
 *   (code !== 200 → unauth / not-found / upstream issue)
 */
const JAVA_USER_BY_ACCOUNT_PATH = '/user/query/user';
const JAVA_USER_BY_USERID_PATH = '/user/other/user/info';

export interface RawLookupResult {
  userId: string;
  nickname: string;
  avatar: string | null;
}

interface JavaEnvelope {
  code?: number;
  msg?: string;
  /** Java uses `info` (not `data`) on this endpoint. */
  info?: {
    id?: number | string;
    nickName?: string;
    avatar?: string;
  } | null;
}

@Injectable()
export class JavaUserLookupService {
  private readonly logger = new Logger(JavaUserLookupService.name);

  /**
   * Resolve a phone OR email to a profile via Java. Returns null on
   * not-found, throws on upstream failure. `cookie` is the viewer's
   * raw cookie string (carries satoken). Java rejects unauthenticated calls.
   */
  async findByContact(
    account: string,
    cookie: string,
  ): Promise<RawLookupResult | null> {
    if (!account) {
      throw new Error('JavaUserLookupService: account required');
    }
    const params = new URLSearchParams({
      account: account.trim(),
      pwd: JAVA_USER_QUERY_PWD,
    });
    const url = `${JAVA_CONTENT_URL}${JAVA_USER_BY_ACCOUNT_PATH}?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      JAVA_REQUEST_TIMEOUT_MS,
    );
    // Log-safe URL: strip pwd value.
    const safeUrl = url.replace(/([?&])pwd=[^&]+/i, '$1pwd=***');

    let envelope: JavaEnvelope;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        signal: controller.signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        this.logger.warn(`Java ${safeUrl} returned HTTP ${res.status}`);
        throw new ServiceUnavailableException({
          message: 'User lookup service unavailable',
          upstream: 'java',
        });
      }
      envelope = (await res.json()) as JavaEnvelope;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Java lookup failed: ${msg} (${safeUrl})`);
      throw new ServiceUnavailableException({
        message: 'User lookup service unavailable',
        upstream: 'java',
      });
    } finally {
      clearTimeout(timeout);
    }

    // Java's soft-fail codes:
    //   code: 302 → "Not logged in!" (sa-token rejected)
    //   code: 404 → not found
    //   anything non-200 → bubble up as upstream issue
    if (envelope.code === 302) {
      this.logger.warn(`Java ${safeUrl} rejected: ${envelope.msg ?? 'unauth'}`);
      throw new ServiceUnavailableException({
        message: 'User lookup not authorised',
        upstream: 'java',
        upstreamCode: 302,
      });
    }
    if (envelope.code === 404 || envelope.info == null) return null;
    if (envelope.code !== undefined && envelope.code !== 200) {
      this.logger.warn(
        `Java ${safeUrl} envelope code=${envelope.code} msg=${envelope.msg}`,
      );
      throw new ServiceUnavailableException({
        message: 'User lookup service error',
        upstream: 'java',
        upstreamCode: envelope.code,
      });
    }

    const raw = envelope.info;
    if (raw?.id == null) return null;

    return {
      userId: String(raw.id),
      nickname: raw.nickName ?? '',
      avatar: raw.avatar ?? null,
    };
  }

  /**
   * Resolve the CURRENT user's full profile via Java `/user/query/user/info`
   * (GET, sa-token cookie auth). Returns the raw `info` object (id, nickName,
   * email, phone, avatar, headImg, …) or null when not logged in / not found.
   */
  async findCurrentUser(
    cookie: string,
  ): Promise<Record<string, unknown> | null> {
    const url = `${JAVA_CONTENT_URL}/user/query/user/info`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      JAVA_REQUEST_TIMEOUT_MS,
    );
    let envelope: JavaEnvelope;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        signal: controller.signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        this.logger.warn(`Java ${url} returned HTTP ${res.status}`);
        throw new ServiceUnavailableException({
          message: 'User info service unavailable',
          upstream: 'java',
        });
      }
      envelope = (await res.json()) as JavaEnvelope;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Java current-user lookup failed: ${msg} (${url})`);
      throw new ServiceUnavailableException({
        message: 'User info service unavailable',
        upstream: 'java',
      });
    } finally {
      clearTimeout(timeout);
    }
    if (Number(envelope.code) !== 200 || envelope.info == null) return null;
    return envelope.info as unknown as Record<string, unknown>;
  }

  /**
   * Resolve the CURRENT user's OWN referral code via Java
   * `GET /user/recommendationcode` (sa-token cookie auth). Java mints it
   * lazily on first call, so this endpoint — NOT a raw `client_user` read —
   * is the canonical way to get it (most rows are still null). Best-effort:
   * returns the trimmed code, or null when not logged in / unavailable, so a
   * code-fetch hiccup never blocks the rest of the referral dashboard.
   */
  async findRecommendationCode(cookie: string): Promise<string | null> {
    if (!cookie) return null;
    const url = `${JAVA_CONTENT_URL}/user/recommendationcode`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      JAVA_REQUEST_TIMEOUT_MS,
    );
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Cookie: cookie },
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`Java ${url} returned HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        code?: number;
        info?: unknown;
        data?: unknown;
      };
      if (Number(body.code) !== 200) return null;
      const raw = body.info ?? body.data;
      const code = typeof raw === 'string' ? raw.trim() : '';
      return code || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Java recommendation-code lookup failed: ${msg}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Resolve a single userId to a public profile via Java
   * `/user/other/user/info?UserId=…`. Cookie auth required (sa-token);
   * cross-user disclosure is limited to `{ userId, nickname, avatar }`
   * by `BY_USERID_PATH` — never returns `contact`, `study`,
   * `description`, etc. even though Java sends them.
   *
   * Returns null on not-found (Java's quirky HTTP 500-as-NPE pattern
   * for unknown ids is also normalized to null here).
   */
  async findByUserId(
    userId: string,
    cookie: string,
  ): Promise<RawLookupResult | null> {
    const trimmed = userId.trim();
    if (!trimmed) {
      throw new Error('JavaUserLookupService: userId required');
    }
    if (!/^\d+$/.test(trimmed)) {
      // Java expects an int64 — fast-reject letters/symbols so we don't
      // burn an upstream request on garbage input.
      return null;
    }
    const params = new URLSearchParams({ UserId: trimmed });
    const url = `${JAVA_CONTENT_URL}${JAVA_USER_BY_USERID_PATH}?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      JAVA_REQUEST_TIMEOUT_MS,
    );

    let envelope: JavaEnvelope;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        signal: controller.signal,
      });
      // Java answers 500 + Spring error JSON for unknown userIds —
      // it's a not-found, not an upstream outage. Treat as null and
      // don't escalate to ServiceUnavailable.
      if (res.status === 404 || res.status === 500) return null;
      if (!res.ok) {
        this.logger.warn(
          `Java ${JAVA_USER_BY_USERID_PATH} returned HTTP ${res.status}`,
        );
        throw new ServiceUnavailableException({
          message: 'User lookup service unavailable',
          upstream: 'java',
        });
      }
      envelope = (await res.json()) as JavaEnvelope;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Java by-userId lookup failed: ${msg}`);
      throw new ServiceUnavailableException({
        message: 'User lookup service unavailable',
        upstream: 'java',
      });
    } finally {
      clearTimeout(timeout);
    }

    if (envelope.code === 302) {
      throw new ServiceUnavailableException({
        message: 'User lookup not authorised',
        upstream: 'java',
        upstreamCode: 302,
      });
    }
    if (envelope.code === 404 || envelope.info == null) return null;
    if (envelope.code !== undefined && envelope.code !== 200) {
      throw new ServiceUnavailableException({
        message: 'User lookup service error',
        upstream: 'java',
        upstreamCode: envelope.code,
      });
    }

    const raw = envelope.info;
    if (raw?.id == null) return null;
    return {
      userId: String(raw.id),
      nickname: raw.nickName ?? '',
      avatar: raw.avatar ?? null,
    };
  }
}
