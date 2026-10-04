import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import {
  ExperienceReleaseResponseSchema,
  type ExperienceReleaseRequest,
} from '@repo/shared/experience-runtime';
import { StoryPublicationStatusSchema } from './story-publication.dto';

const REQUEST_TIMEOUT_MS = 5_000;
const ADMIN_PATH = '/api/admin/interactive-film';
const NOT_FOUND = Symbol('Java publication not found');
// The transport boundary must return a validation failure for malformed URLs.
const UploadReceiptSchema = ExperienceReleaseResponseSchema.extend({
  manifestUrl: z.url().refine((value) => /^https?:\/\//i.test(value)),
});
const DetailSchema = z.object({
  gameId: z.string().min(1),
  status: StoryPublicationStatusSchema,
  rejectReason: z.string().nullable().optional(),
  draftVersion: z.string().min(1).nullable().optional(),
  currentVersion: z.string().min(1).nullable().optional(),
});

export type JavaStoryPublication = z.infer<typeof DetailSchema>;
type JavaEnvelope = { code?: unknown; msg?: unknown; data?: unknown };

/**
 * Server-only adapter for the existing Java management GET/status API.
 * Nest authorizes the project and restricts management to read/submit/offline;
 * the service credential is never forwarded to Studio or used for moderation.
 * Java's creator upload endpoint retains the authenticated actor's authorship.
 * Upload uses the actual actor's own session; no author session is borrowed.
 */
@Injectable()
export class StoryPublicationJavaService {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly tokenHeader: string;

  constructor() {
    this.baseUrl = requiredStudioUrl();
    this.token = requiredValue('JAVA_ADMIN_API_TOKEN');
    this.tokenHeader =
      process.env.JAVA_ADMIN_API_TOKEN_HEADER?.trim() || 'X-Admin-Api-Token';
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(this.tokenHeader) ||
      /^(authorization|cookie|host|origin|accept|content-type|content-length)$/i.test(
        this.tokenHeader,
      )
    ) {
      throw new Error(
        'JAVA_ADMIN_API_TOKEN_HEADER must be a dedicated HTTP header.',
      );
    }
    // Invalid-header errors can include the original value. Keep credentials
    // out of readiness logs even when the configured token is malformed.
    try {
      new Headers({ [this.tokenHeader]: this.token });
    } catch {
      throw new Error(
        'JAVA_ADMIN_API_TOKEN must be a valid HTTP header value.',
      );
    }
  }

  async read(
    gameId: string,
    signal?: AbortSignal,
  ): Promise<JavaStoryPublication | null> {
    const result = await this.request(
      `${ADMIN_PATH}/${encodeURIComponent(gameId)}`,
      'GET',
      undefined,
      'service',
      true,
      undefined,
      signal,
    );
    return result === NOT_FOUND ? null : parseDetail(result, gameId);
  }

  async transition(
    gameId: string,
    action: 'submit' | 'offline',
    signal?: AbortSignal,
  ): Promise<JavaStoryPublication> {
    return parseDetail(
      await this.request(
        `${ADMIN_PATH}/${encodeURIComponent(gameId)}/status`,
        'POST',
        { action },
        'service',
        false,
        undefined,
        signal,
      ),
      gameId,
    );
  }

  async upload(
    request: ExperienceReleaseRequest,
    actorCookie: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!actorCookie) {
      throw new UnauthorizedException({
        code: 'STORY_PUBLICATION_SESSION_REQUIRED',
        message: 'Sign in again before submitting this work.',
      });
    }
    const data = await this.request(
      '/api/user/interactive-film/releases',
      'POST',
      request,
      'actor',
      false,
      actorCookie,
      signal,
    );
    const parsed = UploadReceiptSchema.safeParse(data);
    if (
      !parsed.success ||
      parsed.data.gameId !== request.gameId ||
      parsed.data.contentVersion !== request.contentVersion ||
      parsed.data.status !== 'draft'
    ) {
      throw invalidResponse(
        'Java returned an invalid candidate upload receipt.',
      );
    }
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body: unknown,
    authentication: 'service' | 'actor',
    allowNotFound = false,
    actorCookie?: string,
    operationSignal?: AbortSignal,
  ): Promise<unknown> {
    assertOperationActive(operationSignal);
    const requestDeadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = operationSignal
      ? AbortSignal.any([operationSignal, requestDeadline])
      : requestDeadline;
    const headers = new Headers({ accept: 'application/json' });
    if (authentication === 'service') headers.set(this.tokenHeader, this.token);
    else headers.set('cookie', actorCookie!);
    if (body !== undefined) headers.set('content-type', 'application/json');
    let response: Response;
    let envelope: JavaEnvelope | null;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Never forward either credential across a Java redirect.
        redirect: 'error',
        cache: 'no-store',
        signal,
      });
      const raw: unknown = await response.json();
      envelope =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as JavaEnvelope)
          : null;
    } catch {
      assertOperationActive(operationSignal);
      throw new ServiceUnavailableException({
        code: 'STORY_PUBLICATION_SERVICE_UNAVAILABLE',
        message:
          'The interactive film publication service could not be reached. Retry the status check before submitting again.',
      });
    }
    assertOperationActive(operationSignal);
    // A missing route / HTML 404 is an integration failure, never a draft.
    if (
      allowNotFound &&
      envelope?.code === 404 &&
      (response.status === 200 || response.status === 404)
    ) {
      return NOT_FOUND;
    }
    if (!response.ok || envelope?.code !== 200) {
      const msg = redactCredentials(
        typeof envelope?.msg === 'string' && envelope.msg.trim()
          ? envelope.msg
          : `Java publication request failed: HTTP ${response.status}`,
        this.token,
        actorCookie,
      );
      const upstreamCode =
        typeof envelope?.code === 'number' ? envelope.code : null;
      const expired =
        response.status === 401 || upstreamCode === 302 || upstreamCode === 401;
      const detail = {
        code:
          expired && authentication === 'actor'
            ? 'STORY_PUBLICATION_SESSION_EXPIRED'
            : 'STORY_PUBLICATION_UPSTREAM_FAILED',
        message: msg,
        msg,
        upstreamCode,
        upstreamHttpStatus: response.status,
        kind:
          authentication === 'service' &&
          (expired || upstreamCode === 403 || response.status === 403)
            ? 'service_authentication'
            : expired
              ? 'session'
              : 'upstream',
      };
      if (expired && authentication === 'actor')
        throw new UnauthorizedException(detail);
      // The caller already passed Nest's project permission check. Java's admin
      // token rejection is an integration failure, not a missing project grant.
      throw new BadGatewayException(detail);
    }
    return envelope.data;
  }
}

function redactCredentials(
  message: string,
  serviceToken: string,
  actorCookie?: string,
): string {
  const credentials = [serviceToken];
  if (actorCookie) {
    credentials.push(actorCookie);
    for (const match of actorCookie.matchAll(/(?:^|;\s*)satoken=([^;]+)/g)) {
      credentials.push(match[1]);
    }
  }
  // Replace literal known values only; keep the rest of Java's actionable error.
  // Full cookies must be replaced before any token they contain.
  for (const credential of [...new Set(credentials)]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)) {
    message = message.replaceAll(credential, '[redacted]');
  }
  return message;
}

function assertOperationActive(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ServiceUnavailableException({
      code: 'STORY_PUBLICATION_OPERATION_STOPPED',
      message:
        'The publication operation expired or was cancelled. Refresh its status before retrying.',
    });
  }
}

function parseDetail(input: unknown, gameId: string): JavaStoryPublication {
  const parsed = DetailSchema.safeParse(input);
  if (!parsed.success || parsed.data.gameId !== gameId) {
    throw invalidResponse(
      'Java returned an invalid interactive film publication.',
    );
  }
  return parsed.data;
}

function invalidResponse(message: string): BadGatewayException {
  return new BadGatewayException({
    code: 'STORY_PUBLICATION_INVALID_RESPONSE',
    message,
  });
}

function requiredValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`Missing required publication configuration: ${name}`);
  return value;
}

function requiredStudioUrl(): string {
  const value = requiredValue('JAVA_STUDIO_URL');
  try {
    const parsed = new URL(value);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('Invalid URL');
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    throw new Error(
      'JAVA_STUDIO_URL must be an HTTP(S) URL without credentials, query or fragment.',
    );
  }
}
