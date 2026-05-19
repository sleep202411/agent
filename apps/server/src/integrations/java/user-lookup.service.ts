/**
 * Java user-lookup adapter — by-contact (email / phone) ONLY.
 *
 *   findByContact(account, cookie) → POST /user/query/user
 *     ?account=…&pwd=…
 *     header  Cookie: <viewer's cookie> (Java sa-token reads satoken here)
 *
 * No by-userId path: Java's `/user/resumer/list/:id` returns resume
 * entries, NOT user profile — there's no public profile-by-id
 * endpoint today. Member-list name resolution falls back to
 * `User <id>` until that lands; see `useUserDisplays` stub on the
 * web side.
 *
 * Failure modes:
 *   - Found     → RawLookupResult
 *   - Not found → null
 *   - Java down / unauth → ServiceUnavailableException (mapped to 502)
 *
 * Security: the shared `pwd` and the viewer's cookie are scrubbed
 * from any log line via `safeUrl` below — never log either.
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
   * raw cookie string (carries satoken); pass "" only when you're
   * sure the dev `AUTH_DISABLED` path doesn't matter — Java will
   * reject with 302 "Not logged in!".
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
}
