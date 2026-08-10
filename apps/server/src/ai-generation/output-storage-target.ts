import { MediaStorageProvider } from '@prisma/client';
import type { AiJobType } from './types';

/**
 * Story's profile of the shared Studio workbench. Jobs carry the Story owner
 * explicitly; the surface remains useful for storage policy and analytics.
 */
export const STORY_STUDIO_WORKBENCH_SURFACE = 'story-studio-workbench';

/**
 * Which storage backend a new job's outputs must be written to, or `null` for
 * "the cell-default binding" (see `StorageModule` — cn → OSS, else → R2).
 *
 * Story workbench video jobs pin `s3_compatible` explicitly so
 * they stay on R2 even if an operator temporarily rolls the cell default back
 * to Azure via `OUTPUT_STORAGE_PROVIDER=azure_blob`. Other job types follow
 * the cell default (no pin).
 */
export function resolveOutputStorageProvider(submission: {
  type: AiJobType;
  sourceSurface: string | undefined;
}): MediaStorageProvider | null {
  return submission.type === 'video' &&
    submission.sourceSurface === STORY_STUDIO_WORKBENCH_SURFACE
    ? MediaStorageProvider.s3_compatible
    : null;
}
