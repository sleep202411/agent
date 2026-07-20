import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LockableInteractiveStoryDraftContentSchema } from '../interactive-film.schema';

const FIXTURE_PATH = resolve(__dirname, 'fixtures/branching-film-draft.json');

/**
 * Test-only, owner-neutral branching story. Product code never imports this
 * fixture and no database seed or runtime route depends on it.
 */
export function buildInteractiveFilmTestBundle() {
  const draftContent = LockableInteractiveStoryDraftContentSchema.parse(
    JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')),
  );
  return { draftContent };
}
