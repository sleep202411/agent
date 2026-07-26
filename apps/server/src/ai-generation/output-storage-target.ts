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
 * "the cell-default binding" (see `StorageModule`).
 *
 * Interactive-film FOOTAGE is the only output class moving to R2, so the
 * predicate is deliberately two-sided: the production canvas surface AND a
 * video job. Reference images authored on that same canvas, and every other
 * surface that shares this endpoint, keep writing exactly where they write
 * today.
 *
 * This is intentionally not driven by `OUTPUT_STORAGE_PROVIDER` — that env is
 * process-wide, so pointing it at R2 would sweep ALL media there.
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
