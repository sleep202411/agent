import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LockableInteractiveFilmDraftContentSchema,
  type InteractiveFilmDraftContent,
} from '../interactive-film.schema';
import { projectStoryFilmRevision } from '../story-film-revision-projector';

const DEFAULT_MODEL_ID = '01980f10-7a20-7c01-8000-000000000002';
const FIXTURE_PATH = resolve(__dirname, 'fixtures/branching-film-draft.json');

export interface InteractiveFilmTestBundleOptions {
  defaultCanonicalModelId?: string;
}

/**
 * Test-only, owner-neutral branching film. Product code never imports this
 * fixture and no database seed or runtime route depends on it.
 */
export function buildInteractiveFilmTestBundle(
  options: InteractiveFilmTestBundleOptions = {},
) {
  const draftContent = LockableInteractiveFilmDraftContentSchema.parse(
    JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')),
  );
  const projection = projectStoryFilmRevision({
    draft: draftContent,
    frameProfile: 'landscape_16_9',
    defaultLocale: 'zh-CN',
    defaultCanonicalModelId:
      options.defaultCanonicalModelId ?? DEFAULT_MODEL_ID,
  });
  return {
    draftContent,
    ...projection,
    clipReferencePlans: draftContent.clipPrompts.map((prompt) => ({
      clipKey: prompt.clipKey,
      bindings: referenceBindings(prompt),
    })),
  };
}

function referenceBindings(
  prompt: InteractiveFilmDraftContent['clipPrompts'][number],
) {
  const nextPosition = new Map<string, number>();
  return prompt.referenceRoleNotes.flatMap((note) => {
    const role =
      note.role === 'omni_reference'
        ? 'omni'
        : note.role === 'first_frame'
          ? 'first_frame'
          : note.role === 'last_frame'
            ? 'last_frame'
            : null;
    if (!role) return [];
    const position = nextPosition.get(role) ?? 0;
    nextPosition.set(role, position + 1);
    return [
      {
        referenceSlotKey: note.referenceId,
        role,
        position,
        required: true as const,
      },
    ];
  });
}
