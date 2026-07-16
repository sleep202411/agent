import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ExperienceReleaseResponseSchema,
  type ExperienceReleaseRequest,
  type ExperienceReleaseResponse,
} from '@repo/shared/experience-runtime';
import {
  JAVA_REQUEST_TIMEOUT_MS,
  JAVA_STUDIO_URL,
} from '../integrations/java/java-config';

export const JAVA_EXPERIENCE_RELEASE_PATH =
  '/api/player/interactive-film/releases' as const;

interface JavaEnvelope {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
}

@Injectable()
export class StoryExperienceReleaseGateway {
  async publish(
    request: ExperienceReleaseRequest,
    auth: { cookie?: string; authorization?: string },
  ): Promise<ExperienceReleaseResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      JAVA_REQUEST_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await fetch(
        `${JAVA_STUDIO_URL}${JAVA_EXPERIENCE_RELEASE_PATH}`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(auth.cookie ? { Cookie: auth.cookie } : {}),
            ...(auth.authorization
              ? { Authorization: auth.authorization }
              : {}),
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'JAVA_EXPERIENCE_RELEASE_UNAVAILABLE',
        message:
          error instanceof Error
            ? error.message
            : 'Java experience release service is unavailable.',
        upstream: 'java-studio',
      });
    } finally {
      clearTimeout(timeout);
    }

    const envelope = await parseEnvelope(response);
    if (!response.ok || envelope.code !== 200) {
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
      throw new BadGatewayException({
        code: 'JAVA_EXPERIENCE_RELEASE_INVALID_RESPONSE',
        message: 'Java returned an invalid experience release response.',
        upstream: 'java-studio',
        issues: parsed.error.issues,
      });
    }
    if (
      parsed.data.gameId !== request.gameId ||
      parsed.data.contentVersion !== request.contentVersion ||
      parsed.data.status !== request.status
    ) {
      throw new BadGatewayException({
        code: 'JAVA_EXPERIENCE_RELEASE_IDENTITY_MISMATCH',
        message:
          'Java returned a release identity that does not match the submitted Build.',
        upstream: 'java-studio',
      });
    }
    return parsed.data;
  }
}

async function parseEnvelope(response: Response): Promise<JavaEnvelope> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' ? (value as JavaEnvelope) : {};
  } catch {
    throw new BadGatewayException({
      code: 'JAVA_EXPERIENCE_RELEASE_INVALID_RESPONSE',
      message: `Java returned a non-JSON experience release response (HTTP ${response.status}).`,
      upstream: 'java-studio',
    });
  }
}
