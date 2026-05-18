/**
 * Java user-lookup adapter.
 *
 * Today Java only exposes by-userId. When the backend ships
 * `/user/query/by-contact` we'll add `findByContact` here and the
 * controller can fan out — for now the BFF is strictly userId in.
 *
 * Caching: handled by the caller (UsersService) with a Redis layer.
 *
 * Failure modes:
 *   - Found     → RawLookupResult
 *   - Not found → null
 *   - Java down → ServiceUnavailableException (mapped to 502)
 */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JAVA_CONTENT_URL, JAVA_REQUEST_TIMEOUT_MS } from './java-config';

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
    const url = `${JAVA_CONTENT_URL}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      JAVA_REQUEST_TIMEOUT_MS,
    );

    let envelope: JavaEnvelope;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        this.logger.warn(`Java ${url} returned HTTP ${res.status}`);
        throw new ServiceUnavailableException({
          message: 'User lookup service unavailable',
          upstream: 'java',
        });
      }
      envelope = (await res.json()) as JavaEnvelope;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Java lookup failed: ${msg}`);
      throw new ServiceUnavailableException({
        message: 'User lookup service unavailable',
        upstream: 'java',
      });
    } finally {
      clearTimeout(timeout);
    }

    // Soft-fail codes: treat 404-ish as "not found".
    if (envelope.code === 404 || envelope.data == null) {
      return null;
    }
    if (envelope.code !== undefined && envelope.code !== 200) {
      this.logger.warn(
        `Java ${url} returned envelope code=${envelope.code} msg=${envelope.msg}`,
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
