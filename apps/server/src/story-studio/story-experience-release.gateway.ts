import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ExperienceReleaseResponseSchema,
  ExperienceGameDetailResponseSchema,
  type ExperienceGameDetailResponse,
  type ExperienceReleaseRequest,
  type ExperienceReleaseResponse,
} from '@repo/shared/experience-runtime';
import {
  JAVA_REQUEST_TIMEOUT_MS,
  JAVA_STUDIO_URL,
} from '../integrations/java/java-config';

export const JAVA_EXPERIENCE_RELEASE_PATH =
  '/api/player/interactive-film/releases' as const;
export const JAVA_EXPERIENCE_GAMES_PATH =
  '/api/player/interactive-film/games' as const;

interface JavaEnvelope {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
}

/**
 * The POST may already have committed at Java when transport or response
 * validation fails. Callers must reconcile through the public game endpoint;
 * treating this as a rejection would revoke media that a live Manifest needs.
 */
export class StoryExperienceReleaseOutcomeUnknownException extends ServiceUnavailableException {
  constructor(input: { code: string; message: string; issues?: unknown }) {
    super({ ...input, upstream: 'java-studio', outcome: 'unknown' });
  }
}

export function isStoryExperienceReleaseOutcomeUnknown(
  error: unknown,
): error is StoryExperienceReleaseOutcomeUnknownException {
  return error instanceof StoryExperienceReleaseOutcomeUnknownException;
}

@Injectable()
export class StoryExperienceReleaseGateway {
  async publish(
    request: ExperienceReleaseRequest,
    viewerCookie: string,
  ): Promise<ExperienceReleaseResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      JAVA_REQUEST_TIMEOUT_MS,
    );
    try {
      let response: Response;
      try {
        response = await fetch(
          `${JAVA_STUDIO_URL}${JAVA_EXPERIENCE_RELEASE_PATH}`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...(viewerCookie ? { Cookie: viewerCookie } : {}),
            },
            body: JSON.stringify(request),
            signal: controller.signal,
          },
        );
      } catch (error) {
        throw new StoryExperienceReleaseOutcomeUnknownException({
          code: 'JAVA_EXPERIENCE_RELEASE_UNAVAILABLE',
          message:
            error instanceof Error
              ? error.message
              : 'Java experience release service is unavailable.',
        });
      }

      if (!response.ok) {
        const envelope = await parseOptionalEnvelope(response);
        if (!isDefinitiveBusinessRejection(response.status)) {
          throw new StoryExperienceReleaseOutcomeUnknownException({
            code: 'JAVA_EXPERIENCE_RELEASE_OUTCOME_UNKNOWN',
            message:
              typeof envelope.msg === 'string' && envelope.msg.trim()
                ? envelope.msg
                : `Java release returned HTTP ${response.status} after the request may have committed.`,
          });
        }
        throw new BadGatewayException({
          code: 'JAVA_EXPERIENCE_RELEASE_REJECTED',
          message:
            typeof envelope.msg === 'string' && envelope.msg.trim()
              ? envelope.msg
              : `Java experience release failed with HTTP ${response.status}.`,
          upstream: 'java-studio',
          upstreamCode: envelope.code ?? null,
        });
      }
      const envelope = await parseEnvelope(response, 'release');
      if (envelope.code !== 200) {
        if (!isDefinitiveBusinessRejection(envelope.code)) {
          throw new StoryExperienceReleaseOutcomeUnknownException({
            code: 'JAVA_EXPERIENCE_RELEASE_OUTCOME_UNKNOWN',
            message:
              typeof envelope.msg === 'string' && envelope.msg.trim()
                ? envelope.msg
                : 'Java returned an ambiguous release result after the request may have committed.',
          });
        }
        throw new BadGatewayException({
          code: 'JAVA_EXPERIENCE_RELEASE_REJECTED',
          message:
            typeof envelope.msg === 'string' && envelope.msg.trim()
              ? envelope.msg
              : `Java experience release failed with HTTP ${response.status}.`,
          upstream: 'java-studio',
          upstreamCode: envelope.code ?? null,
        });
      }
      const parsed = ExperienceReleaseResponseSchema.safeParse(envelope.data);
      if (!parsed.success) {
        throw new StoryExperienceReleaseOutcomeUnknownException({
          code: 'JAVA_EXPERIENCE_RELEASE_INVALID_RESPONSE',
          message: 'Java returned an invalid experience release response.',
          issues: parsed.error.issues,
        });
      }
      if (
        parsed.data.gameId !== request.gameId ||
        parsed.data.contentVersion !== request.contentVersion ||
        parsed.data.status !== request.status
      ) {
        throw new StoryExperienceReleaseOutcomeUnknownException({
          code: 'JAVA_EXPERIENCE_RELEASE_IDENTITY_MISMATCH',
          message:
            'Java returned a release identity that does not match the submitted Build.',
        });
      }
      return parsed.data;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Java is the sole authority for the player-visible current version. This
   * read endpoint is intentionally public: reconciliation workers must never
   * persist or impersonate a creator credential after an uncertain POST.
   */
  async getGame(gameId: string): Promise<ExperienceGameDetailResponse | null> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      JAVA_REQUEST_TIMEOUT_MS,
    );
    try {
      let response: Response;
      try {
        response = await fetch(
          `${JAVA_STUDIO_URL}${JAVA_EXPERIENCE_GAMES_PATH}/${encodeURIComponent(gameId)}`,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          },
        );
      } catch (error) {
        throw new ServiceUnavailableException({
          code: 'JAVA_EXPERIENCE_GAME_UNAVAILABLE',
          message:
            error instanceof Error
              ? error.message
              : 'Java experience game service is unavailable.',
          upstream: 'java-studio',
        });
      }

      if (response.status === 404) {
        return null;
      }
      const envelope = await parseEnvelope(response, 'game');
      if (response.ok && envelope.code === 404) return null;
      if (!response.ok || envelope.code !== 200) {
        throw new BadGatewayException({
          code: 'JAVA_EXPERIENCE_GAME_REJECTED',
          message:
            typeof envelope.msg === 'string' && envelope.msg.trim()
              ? envelope.msg
              : `Java experience game lookup failed with HTTP ${response.status}.`,
          upstream: 'java-studio',
          upstreamCode: envelope.code ?? null,
        });
      }
      const parsed = ExperienceGameDetailResponseSchema.safeParse(
        envelope.data,
      );
      if (!parsed.success) {
        throw new BadGatewayException({
          code: 'JAVA_EXPERIENCE_GAME_INVALID_RESPONSE',
          message: 'Java returned an invalid experience game response.',
          upstream: 'java-studio',
          issues: parsed.error.issues,
        });
      }
      if (parsed.data.gameId !== gameId) {
        throw new BadGatewayException({
          code: 'JAVA_EXPERIENCE_GAME_IDENTITY_MISMATCH',
          message:
            'Java returned an experience game identity that does not match the request.',
          upstream: 'java-studio',
        });
      }
      return parsed.data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isDefinitiveBusinessRejection(value: unknown): boolean {
  return (
    typeof value === 'number' && value >= 400 && value < 500 && value !== 408
  );
}

async function parseOptionalEnvelope(
  response: Response,
): Promise<JavaEnvelope> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' ? (value as JavaEnvelope) : {};
  } catch {
    return {};
  }
}

async function parseEnvelope(
  response: Response,
  operation: 'release' | 'game',
): Promise<JavaEnvelope> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' ? (value as JavaEnvelope) : {};
  } catch {
    if (operation === 'release') {
      throw new StoryExperienceReleaseOutcomeUnknownException({
        code: 'JAVA_EXPERIENCE_RELEASE_INVALID_RESPONSE',
        message: `Java returned a non-JSON experience release response (HTTP ${response.status}).`,
      });
    }
    throw new BadGatewayException({
      code: 'JAVA_EXPERIENCE_GAME_INVALID_RESPONSE',
      message: `Java returned a non-JSON experience game response (HTTP ${response.status}).`,
      upstream: 'java-studio',
    });
  }
}
