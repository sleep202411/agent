import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import {
  JAVA_REQUEST_TIMEOUT_MS,
  JAVA_STUDIO_URL,
} from '../integrations/java/java-config';

const PublicGameSchema = z
  .object({
    gameId: z.string().min(1),
    currentVersion: z.string().min(1),
    status: z.string().optional(),
  })
  .passthrough();

/** Java's existing public player lookup authorizes the exact visible version. */
@Injectable()
export class StoryPublicationAuthorityService {
  async currentPublicVersion(gameId: string): Promise<string | null> {
    let response: Response;
    let body: { code?: unknown; msg?: unknown; data?: unknown } | null;
    try {
      response = await fetch(
        `${JAVA_STUDIO_URL}/api/player/interactive-film/games/${encodeURIComponent(gameId)}`,
        {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(JAVA_REQUEST_TIMEOUT_MS),
        },
      );
      body = (await response.json().catch(() => null)) as typeof body;
    } catch {
      throw unavailable(
        'The published interactive film could not be verified.',
      );
    }
    if (response.status === 404 || body?.code === 404) return null;
    if (!response.ok || body?.code !== 200) {
      throw unavailable(
        typeof body?.msg === 'string' && body.msg.trim()
          ? body.msg
          : 'The published interactive film could not be verified.',
      );
    }
    const parsed = PublicGameSchema.safeParse(body.data);
    if (!parsed.success || parsed.data.gameId !== gameId) {
      throw unavailable('Java returned an invalid published interactive film.');
    }
    // The endpoint omits withdrawn and reviewing works. If Java additionally
    // supplies status, treat it as an explicit authorization restriction.
    if (parsed.data.status && parsed.data.status !== 'published') return null;
    return parsed.data.currentVersion;
  }
}

function unavailable(message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'STORY_PUBLICATION_AUTHORITY_UNAVAILABLE',
    message,
  });
}
