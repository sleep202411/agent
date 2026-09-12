import { ServiceUnavailableException } from '@nestjs/common';
import { extractVideoPoster } from '../media/video-poster.service';

const posters = new Map<string, { expiresAt: number; body: Promise<Buffer> }>();
let processing = 0;

/** Small bounded cache; callers must re-authorize before every lookup. */
export function readStoryPoster(key: string, source: string): Promise<Buffer> {
  const existing = posters.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.body;
  if (processing >= 2)
    throw new ServiceUnavailableException('Preview is busy. Please try again.');
  for (const [id, entry] of posters) {
    if (entry.expiresAt <= Date.now()) posters.delete(id);
  }
  const oldest = [...posters.keys()][0];
  if (posters.size >= 24 && oldest) posters.delete(oldest);
  processing++;
  const body = extractVideoPoster(source, true)
    .catch((error: unknown) => {
      posters.delete(key);
      throw error;
    })
    .finally(() => {
      processing--;
    });
  posters.set(key, { expiresAt: Date.now() + 5 * 60_000, body });
  return body;
}
