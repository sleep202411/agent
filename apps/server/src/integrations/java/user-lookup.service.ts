/**
 * Java user-lookup adapter.
 *
 * Two resolution paths to the same `RawLookupResult` shape:
 *   - findByUserId(userId)        → GET  /user/resumer/list/:userId
 *   - findByContact(email|phone)  → POST /user/query/user?account=…&pwd=…
 *
 * Caching: handled by the caller (UsersService) with a Redis layer.
 *
 * Failure modes:
 *   - Found     → RawLookupResult
 *   - Not found → null
 *   - Java down → ServiceUnavailableException (mapped to 502)
 *
 * Security: the shared `pwd` secret for the by-contact endpoint is
 * stripped from any log line via `safeUrl` below.
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
 * Java endpoint path template. Centralized so a backend rename is one
 * line — do not inline this elsewhere. `:userId` is substituted at
 * call time after URL-encoding.
 *
 * Expected wire contract:
 *   GET {JAVA_CONTENT_URL}/user/resumer/list/:userId
 *   response: {
 *     code: 200,
 *     data: { userId: number|string, nickName?: string, avatar?: string, ... } | null
 *   }
 *   (data === null / 404 → user does not exist)
 */
const JAVA_USER_BY_ID_PATH = '/user/resumer/list/:userId';

/**
 * Java endpoint that resolves an email OR phone to a full user.
 * Guarded by a shared-secret `pwd` query param — see env.
 * POST with query-string params; no body.
 *
 *   POST {JAVA_CONTENT_URL}/user/query/user?account=...&pwd=...
 *   response: { code, data: { userId, nickName, avatar, ... } | null }
 */
const JAVA_USER_BY_ACCOUNT_PATH = '/user/query/user';

export interface RawLookupResult {
  userId: string;
  nickname: string;
  avatar: string | null;
}

interface JavaEnvelope {
  code?: number;
  msg?: string;
  data?: {
    userId?: number | string;
    nickName?: string;
    avatar?: string;
  } | null;
}

@Injectable()
export class JavaUserLookupService {
  private readonly logger = new Logger(JavaUserLookupService.name);

  /**
   * Resolve a userId to user profile via Java. Returns null when Java
   * says the user doesn't exist; throws ServiceUnavailable on network
   * / Java errors.
   */
  async findByUserId(userId: string): Promise<RawLookupResult | null> {
    if (!userId) {
      throw new Error('JavaUserLookupService: userId required');
    }
    const path = JAVA_USER_BY_ID_PATH.replace(
      ':userId',
      encodeURIComponent(userId),
    );
    return this.callAndParse(`${JAVA_CONTENT_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  }

  async findByContact(account: string): Promise<RawLookupResult | null> {
    if (!account) {
      throw new Error('JavaUserLookupService: account required');
    }
    const params = new URLSearchParams({
      account: account.trim(),
      pwd: JAVA_USER_QUERY_PWD,
    });
    const url = `${JAVA_CONTENT_URL}${JAVA_USER_BY_ACCOUNT_PATH}?${params.toString()}`;
    // Java's contract: POST with no body, params on the URL.
    return this.callAndParse(url, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
  }

  /**
   * Shared transport + envelope handling. All logged URLs are
   * sanitised so the `pwd` shared secret never lands in stdout.
   */
  private async callAndParse(
    url: string,
    init: RequestInit,
  ): Promise<RawLookupResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      JAVA_REQUEST_TIMEOUT_MS,
    );
    const safeUrl = url.replace(/([?&])pwd=[^&]+/i, '$1pwd=***');

    let envelope: JavaEnvelope;
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
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

    if (envelope.code === 404 || envelope.data == null) return null;
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

    const raw = envelope.data;
    if (raw?.userId == null) return null;

    return {
      userId: String(raw.userId),
      nickname: raw.nickName ?? '',
      avatar: raw.avatar ?? null,
    };
  }
}
