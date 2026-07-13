import {
  StoryFilmTakeStatus,
  type StoryFilmClipReferenceRole,
} from '@prisma/client';
import type { FilmClipSpec } from './interactive-film.schema';

export interface FilmClipProductionBlockReason {
  code:
    | 'REFERENCE_APPROVAL_REQUIRED'
    | 'OMNI_REFERENCE_REQUIRED'
    | 'FIRST_FRAME_REQUIRED'
    | 'LAST_FRAME_REQUIRED';
  message: string;
}

export interface FilmProductionSummaryReadModel {
  productionStatus:
    | 'blocked'
    | 'ready'
    | 'generating'
    | 'in_review'
    | 'approved'
    | 'stale';
  blockReasons: Array<
    | FilmClipProductionBlockReason
    | {
        code: 'MASTER_INPUT_STALE';
        message: string;
      }
  >;
  takeCounts: {
    total: number;
    running: number;
    ready: number;
    approved: number;
  };
}

/**
 * Read-model blockers describe inputs that are actually absent. A null
 * productionInputHash is deliberately not a blocker: the first Create Take
 * request freezes that manifest atomically after all real inputs validate.
 */
export function filmClipProductionBlockReasons(
  clip: Pick<FilmClipSpec, 'generationControl'>,
  references: Array<{
    role: StoryFilmClipReferenceRole;
    required: boolean;
    approvedReferenceVersionId: string | null;
  }>,
): FilmClipProductionBlockReason[] {
  const reasons: FilmClipProductionBlockReason[] = references
    .filter(
      (binding) =>
        binding.required && binding.approvedReferenceVersionId === null,
    )
    .map(() => ({
      code: 'REFERENCE_APPROVAL_REQUIRED' as const,
      message: 'A required reference slot has no approved version.',
    }));
  const roles = new Set(references.map((binding) => binding.role));
  if (clip.generationControl.mode === 'omni_reference') {
    if (!roles.has('omni')) {
      reasons.push({
        code: 'OMNI_REFERENCE_REQUIRED',
        message: 'The Omni Reference task has no bound reference input.',
      });
    }
    return reasons;
  }
  if (!roles.has('first_frame')) {
    reasons.push({
      code: 'FIRST_FRAME_REQUIRED',
      message: 'The Frame Lock task has no bound first frame.',
    });
  }
  if (
    clip.generationControl.frameMode === 'first_last_frame' &&
    !roles.has('last_frame')
  ) {
    reasons.push({
      code: 'LAST_FRAME_REQUIRED',
      message: 'The First + Last Frame task has no bound last frame.',
    });
  }
  return reasons;
}

/** One authoritative production-state projection for Trailer GET, Master
 * mutation responses, and the Story Workbench. */
export function filmTrailerProductionReadModel(input: {
  trailer: Pick<FilmClipSpec, 'generationControl'>;
  references: Array<{
    role: StoryFilmClipReferenceRole;
    required: boolean;
    approvedReferenceVersionId: string | null;
  }>;
  takes: Array<{
    status: StoryFilmTakeStatus;
    approval: object | null;
  }>;
  productionInputHash: string | null;
  masterTakeId: string | null;
  masterTake: { productionInputHash: string } | null;
}): FilmProductionSummaryReadModel {
  const referenceBlockReasons = filmClipProductionBlockReasons(
    input.trailer,
    input.references,
  );
  const stale = Boolean(
    input.masterTake &&
    input.masterTake.productionInputHash !== input.productionInputHash,
  );
  const running = input.takes.filter(
    (take) =>
      take.status === StoryFilmTakeStatus.queued ||
      take.status === StoryFilmTakeStatus.running ||
      take.status === StoryFilmTakeStatus.processing,
  ).length;
  const ready = input.takes.filter(
    (take) => take.status === StoryFilmTakeStatus.ready,
  ).length;
  const approved = input.takes.filter((take) => take.approval !== null).length;
  return {
    productionStatus: stale
      ? 'stale'
      : referenceBlockReasons.length > 0
        ? 'blocked'
        : input.masterTakeId && input.masterTake
          ? 'approved'
          : running > 0
            ? 'generating'
            : ready > 0
              ? 'in_review'
              : 'ready',
    blockReasons: stale
      ? [
          {
            code: 'MASTER_INPUT_STALE',
            message: 'The selected trailer master uses older inputs.',
          },
        ]
      : referenceBlockReasons,
    takeCounts: {
      total: input.takes.length,
      running,
      ready,
      approved,
    },
  };
}
