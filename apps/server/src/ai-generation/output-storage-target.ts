import { MediaStorageProvider } from '@prisma/client';
import type { AiJobType } from './types';

/**
 * The Story Studio production canvas — the only surface that authors
 * interactive-film footage. It has no generation plane of its own: since
 * `20260724000000_remove_story_video_generation` it submits through the shared
 * `POST /aurora/ai/jobs` endpoint like every other canvas, and the job row
 * carries no story-project id (`AiJob.projectId` is a PlatformProject FK,
 * StoryProject is a different table). The surface tag is therefore the one
 * thing on the submission that distinguishes its work.
 */
export const STORY_PRODUCTION_CANVAS_SURFACE = 'story-studio-production-canvas';

/**
 * Which storage backend a new job's outputs must be written to, or `null` for
 * "the cell-default binding" (see `StorageModule` — cn → OSS, else → R2).
 *
 * Story production-canvas video jobs still pin `s3_compatible` explicitly so
 * they stay on R2 even if an operator temporarily rolls the cell default back
 * to Azure via `OUTPUT_STORAGE_PROVIDER=azure_blob`. Other job types follow
 * the cell default (no pin).
 */
export function resolveOutputStorageProvider(submission: {
  type: AiJobType;
  sourceSurface: string | undefined;
}): MediaStorageProvider | null {
  return submission.type === 'video' &&
    submission.sourceSurface === STORY_PRODUCTION_CANVAS_SURFACE
    ? MediaStorageProvider.s3_compatible
    : null;
}
