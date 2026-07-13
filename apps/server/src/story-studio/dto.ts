import { z } from 'zod';
import {
  FilmBuildScopeSchema,
  FilmClipDependencySpecSchema,
  FilmClipReferenceBindingInputSchema,
  FilmClipReferencePlanSchema,
  FilmClipSpecSchema,
  FilmReferenceSlotSpecSchema,
  FilmReviewDecisionSchema,
  FilmSpecSchema,
  FilmTakeReviewChecklistSchema,
  FilmTrailerTakeReviewChecklistSchema,
  INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION,
  InteractiveFilmDraftContentSchema,
  ReviewChecklistValueSchema,
  StoryDeploymentEnvironmentSchema,
  StoryReleaseChannelSchema,
  StoryStableIdSchema,
  StoryUuidSchema,
  type FilmBuildScope,
  type FilmBuildStatus,
  type FilmClipDependencySpec,
  type FilmClipReferenceBindingInput,
  type FilmClipSpec,
  type FilmReferenceSlotSpec,
  type FilmReviewDecision,
  type FilmSpec,
  type FilmTakeStatus,
  type FilmTrailerSpec,
  type InteractiveFilmDraftContent,
  type StoryDeploymentEnvironment,
  type StoryDeploymentStatus,
  type StoryReleaseChannel,
} from './interactive-film.schema';

export * from './interactive-film.schema';

/** Product-level Story Studio core and interactive-film API contracts. */

export const STORY_TITLE_MAX = 160;
export const STORY_SUMMARY_MAX = 2_000;
export const STORY_TAG_MAX = 40;
export const STORY_TAG_COUNT_MAX = 12;
export const STORY_CANVAS_LAYOUT_SCHEMA_VERSION =
  'story-canvas-layout-v1' as const;
export const STORY_CANVAS_LAYOUT_NODE_COUNT_MAX = 1_000;
export const STORY_CANVAS_LAYOUT_COORDINATE_ABS_MAX = 1_000_000;

export const StoryFormatSchema = z.enum([
  'text_adventure',
  'interactive_film',
  'narrative_rpg',
]);
export type StoryFormat = z.infer<typeof StoryFormatSchema>;

/** First product slice. The wider StoryFormat type remains future-ready. */
export const CreatableStoryFormatSchema = z.literal('interactive_film');
export type CreatableStoryFormat = z.infer<typeof CreatableStoryFormatSchema>;

export const StoryProjectStatusSchema = z.enum(['active', 'archived']);
export type StoryProjectStatus = z.infer<typeof StoryProjectStatusSchema>;

export const StoryFrameProfileSchema = z.enum([
  'landscape_16_9',
  'portrait_9_16',
]);
export type StoryFrameProfile = z.infer<typeof StoryFrameProfileSchema>;

export const STORY_FRAME_PROFILE_CONTRACTS = {
  landscape_16_9: {
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
  },
  portrait_9_16: {
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
  },
} as const satisfies Record<
  StoryFrameProfile,
  { aspectRatio: '16:9' | '9:16'; width: number; height: number }
>;

export type StoryFrameContract =
  (typeof STORY_FRAME_PROFILE_CONTRACTS)[StoryFrameProfile];

export function frameContractMatchesStoryProfile(
  frameProfile: StoryFrameProfile,
  frame: { aspectRatio: '16:9' | '9:16'; width: number; height: number },
): boolean {
  const expected = STORY_FRAME_PROFILE_CONTRACTS[frameProfile];
  return (
    frame.aspectRatio === expected.aspectRatio &&
    frame.width === expected.width &&
    frame.height === expected.height
  );
}

export const StoryVisibilitySchema = z.enum(['private', 'unlisted', 'public']);
export type StoryVisibility = z.infer<typeof StoryVisibilitySchema>;

export const StoryProjectRoleSchema = z.enum([
  'owner',
  'producer',
  'editor',
  'reviewer',
  'viewer',
]);
export type StoryProjectRole = z.infer<typeof StoryProjectRoleSchema>;

export const StoryCapabilitySchema = z.enum([
  'story.read',
  'story.edit',
  'story.generate',
  'story.review',
  'story.build',
  'story.release',
  'story.admin',
]);
export type StoryCapability = z.infer<typeof StoryCapabilitySchema>;

const StoryTitleSchema = z.string().trim().min(1).max(STORY_TITLE_MAX);
const StorySummarySchema = z.string().trim().max(STORY_SUMMARY_MAX).nullable();
const StoryTagsSchema = z
  .array(z.string().trim().min(1).max(STORY_TAG_MAX))
  .max(STORY_TAG_COUNT_MAX)
  .refine((tags) => new Set(tags).size === tags.length, {
    message: 'Tags must not contain duplicates.',
  });
const NonNegativeVersionSchema = z.number().int().nonnegative();
const SessionIdSchema = z.string().trim().min(1).max(64);

export const StoryCanvasNodeIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z_][A-Za-z0-9._:-]*$/, 'Use a safe canvas node identifier.');
export const StoryCanvasNodePositionSchema = z
  .object({
    x: z
      .number()
      .finite()
      .min(-STORY_CANVAS_LAYOUT_COORDINATE_ABS_MAX)
      .max(STORY_CANVAS_LAYOUT_COORDINATE_ABS_MAX),
    y: z
      .number()
      .finite()
      .min(-STORY_CANVAS_LAYOUT_COORDINATE_ABS_MAX)
      .max(STORY_CANVAS_LAYOUT_COORDINATE_ABS_MAX),
  })
  .strict();
export const StoryCanvasNodePositionsSchema = z
  .record(StoryCanvasNodeIdSchema, StoryCanvasNodePositionSchema)
  .refine(
    (positions) =>
      Object.keys(positions).length <= STORY_CANVAS_LAYOUT_NODE_COUNT_MAX,
    {
      message: `Canvas layouts support at most ${STORY_CANVAS_LAYOUT_NODE_COUNT_MAX} nodes.`,
    },
  );
export type StoryCanvasNodePositions = z.infer<
  typeof StoryCanvasNodePositionsSchema
>;

// ─── Route params and list queries ──────────────────────────────────────

export const StoryProjectIdParamsSchema = z
  .object({ projectId: StoryUuidSchema })
  .strict();
export type StoryProjectIdParams = z.infer<typeof StoryProjectIdParamsSchema>;

export const StoryRevisionParamsSchema = z
  .object({ projectId: StoryUuidSchema, revisionId: StoryUuidSchema })
  .strict();
export type StoryRevisionParams = z.infer<typeof StoryRevisionParamsSchema>;

export const StoryFilmClipParamsSchema = z
  .object({
    projectId: StoryUuidSchema,
    revisionId: StoryUuidSchema,
    clipId: StoryUuidSchema,
  })
  .strict();
export type StoryFilmClipParams = z.infer<typeof StoryFilmClipParamsSchema>;

export const StoryFilmDraftClipParamsSchema = z
  .object({
    projectId: StoryUuidSchema,
    graphNodeId: StoryStableIdSchema,
  })
  .strict();
export type StoryFilmDraftClipParams = z.infer<
  typeof StoryFilmDraftClipParamsSchema
>;

export const StoryFilmReferenceSlotParamsSchema = z
  .object({
    projectId: StoryUuidSchema,
    revisionId: StoryUuidSchema,
    slotId: StoryUuidSchema,
  })
  .strict();
export type StoryFilmReferenceSlotParams = z.infer<
  typeof StoryFilmReferenceSlotParamsSchema
>;

export const StoryFilmReferenceVersionParamsSchema = z
  .object({
    projectId: StoryUuidSchema,
    revisionId: StoryUuidSchema,
    slotId: StoryUuidSchema,
    referenceVersionId: StoryUuidSchema,
  })
  .strict();
export type StoryFilmReferenceVersionParams = z.infer<
  typeof StoryFilmReferenceVersionParamsSchema
>;

export const StoryFilmTakeParamsSchema = z
  .object({ projectId: StoryUuidSchema, takeId: StoryUuidSchema })
  .strict();
export type StoryFilmTakeParams = z.infer<typeof StoryFilmTakeParamsSchema>;

export const StoryFilmTrailerTakeParamsSchema = z
  .object({ projectId: StoryUuidSchema, takeId: StoryUuidSchema })
  .strict();
export type StoryFilmTrailerTakeParams = z.infer<
  typeof StoryFilmTrailerTakeParamsSchema
>;

export const StoryFilmBuildParamsSchema = z
  .object({ projectId: StoryUuidSchema, buildId: StoryUuidSchema })
  .strict();
export type StoryFilmBuildParams = z.infer<typeof StoryFilmBuildParamsSchema>;

export const StoryFilmBuildAssetParamsSchema = z
  .object({
    projectId: StoryUuidSchema,
    buildId: StoryUuidSchema,
    assetId: StoryUuidSchema,
    variantId: StoryUuidSchema,
  })
  .strict();
export type StoryFilmBuildAssetParams = z.infer<
  typeof StoryFilmBuildAssetParamsSchema
>;

export const StoryReleaseParamsSchema = z
  .object({ projectId: StoryUuidSchema, releaseId: StoryUuidSchema })
  .strict();
export type StoryReleaseParams = z.infer<typeof StoryReleaseParamsSchema>;

export const StoryProjectListQuerySchema = z
  .object({
    format: StoryFormatSchema.optional(),
    status: StoryProjectStatusSchema.default('active'),
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type StoryProjectListQuery = z.infer<typeof StoryProjectListQuerySchema>;

export const StoryWorkbenchQuerySchema = z
  .object({ revisionId: StoryUuidSchema.optional() })
  .strict();
export type StoryWorkbenchQuery = z.infer<typeof StoryWorkbenchQuerySchema>;

export const StoryWorkingPreviewQuerySchema = z
  .object({
    expectedDraftRevision: z.coerce.number().int().nonnegative(),
  })
  .strict();
export type StoryWorkingPreviewQuery = z.infer<
  typeof StoryWorkingPreviewQuerySchema
>;

export const StoryRevisionListQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type StoryRevisionListQuery = z.infer<
  typeof StoryRevisionListQuerySchema
>;

export const FilmTakeListQuerySchema = z
  .object({
    status: z
      .enum(['queued', 'running', 'processing', 'ready', 'failed', 'cancelled'])
      .optional(),
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type FilmTakeListQuery = z.infer<typeof FilmTakeListQuerySchema>;

export const FilmBuildListQuerySchema = z
  .object({
    profile: z.enum(['preview', 'production']).optional(),
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type FilmBuildListQuery = z.infer<typeof FilmBuildListQuerySchema>;

export const StoryReleaseListQuerySchema = z
  .object({
    channel: StoryReleaseChannelSchema.optional(),
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type StoryReleaseListQuery = z.infer<typeof StoryReleaseListQuerySchema>;

// ─── Core project, draft, and immutable revision requests ───────────────

export const CreateStoryProjectSchema = z
  .object({
    format: CreatableStoryFormatSchema,
    frameProfile: StoryFrameProfileSchema,
    title: StoryTitleSchema,
    summary: StorySummarySchema.optional(),
    defaultLocale: z.string().trim().min(2).max(16),
    visibility: StoryVisibilitySchema.extract(['private', 'unlisted']).default(
      'private',
    ),
    sourceIpId: StoryUuidSchema.nullable().optional(),
  })
  .strict();
export type CreateStoryProjectInput = z.infer<typeof CreateStoryProjectSchema>;

export const PatchStoryProjectSchema = z
  .object({
    expectedProjectVersion: NonNegativeVersionSchema,
    title: StoryTitleSchema.optional(),
    summary: StorySummarySchema.optional(),
    coverAssetId: StoryUuidSchema.nullable().optional(),
    defaultLocale: z.string().trim().min(2).max(16).optional(),
    visibility: StoryVisibilitySchema.optional(),
    tags: StoryTagsSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).some((key) => key !== 'expectedProjectVersion'),
    { message: 'Provide at least one project field to update.' },
  );
export type PatchStoryProjectInput = z.infer<typeof PatchStoryProjectSchema>;

export const ArchiveStoryProjectSchema = z
  .object({ expectedProjectVersion: NonNegativeVersionSchema })
  .strict();
export type ArchiveStoryProjectInput = z.infer<
  typeof ArchiveStoryProjectSchema
>;

export const PutStoryDraftSchema = z
  .object({
    expectedRevision: NonNegativeVersionSchema,
    schemaVersion: z.literal(INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION),
    content: InteractiveFilmDraftContentSchema,
    sessionId: SessionIdSchema,
  })
  .strict();
export type PutStoryDraftInput = z.infer<typeof PutStoryDraftSchema>;

export const PutStoryCanvasLayoutSchema = z
  .object({
    expectedRevision: NonNegativeVersionSchema,
    schemaVersion: z.literal(STORY_CANVAS_LAYOUT_SCHEMA_VERSION),
    nodePositions: StoryCanvasNodePositionsSchema,
    sessionId: SessionIdSchema,
  })
  .strict();
export type PutStoryCanvasLayoutInput = z.infer<
  typeof PutStoryCanvasLayoutSchema
>;

export const LockStoryRevisionSchema = z
  .object({
    expectedDraftRevision: NonNegativeVersionSchema,
    label: z.string().trim().min(1).max(160).optional(),
    source: z.enum(['creator', 'import']).default('creator'),
  })
  .strict();
export type LockStoryRevisionInput = z.infer<typeof LockStoryRevisionSchema>;

// ─── Film spec and clip requests ────────────────────────────────────────

export const PutFilmSpecSchema = z
  .object({
    /** null creates the one-per-revision FilmSpec; a number updates it. */
    expectedVersion: NonNegativeVersionSchema.nullable(),
    expectedProductionRevision: NonNegativeVersionSchema,
    spec: FilmSpecSchema,
  })
  .strict();
export type PutFilmSpecInput = z.infer<typeof PutFilmSpecSchema>;

export const CreateFilmClipsBatchSchema = z
  .object({
    expectedProductionRevision: NonNegativeVersionSchema,
    clips: z.array(FilmClipSpecSchema).min(1).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    const keys = new Set<string>();
    const graphNodeIds = new Set<string>();
    input.clips.forEach((clip, index) => {
      if (keys.has(clip.key)) {
        context.addIssue({
          code: 'custom',
          path: ['clips', index, 'key'],
          message: `Duplicate clip key ${clip.key}.`,
        });
      }
      if (graphNodeIds.has(clip.graphNodeId)) {
        context.addIssue({
          code: 'custom',
          path: ['clips', index, 'graphNodeId'],
          message: `Graph node ${clip.graphNodeId} already has a clip.`,
        });
      }
      keys.add(clip.key);
      graphNodeIds.add(clip.graphNodeId);
    });
  });
export type CreateFilmClipsBatchInput = z.infer<
  typeof CreateFilmClipsBatchSchema
>;

export const PutFilmClipSchema = z
  .object({
    expectedVersion: NonNegativeVersionSchema,
    expectedProductionRevision: NonNegativeVersionSchema,
    spec: FilmClipSpecSchema,
  })
  .strict();
export type PutFilmClipInput = z.infer<typeof PutFilmClipSchema>;

export const ArchiveFilmClipSchema = z
  .object({
    expectedVersion: NonNegativeVersionSchema,
    expectedProductionRevision: NonNegativeVersionSchema,
  })
  .strict();
export type ArchiveFilmClipInput = z.infer<typeof ArchiveFilmClipSchema>;

export const PutFilmClipReferencesSchema = z
  .object({
    expectedClipVersion: NonNegativeVersionSchema,
    expectedProductionRevision: NonNegativeVersionSchema,
    bindings: z.array(FilmClipReferenceBindingInputSchema).max(50),
  })
  .strict();
export type PutFilmClipReferencesInput = z.infer<
  typeof PutFilmClipReferencesSchema
>;

export const PutFilmTrailerReferencesSchema = z
  .object({
    expectedTrailerVersion: NonNegativeVersionSchema,
    bindings: z.array(FilmClipReferenceBindingInputSchema).max(50),
  })
  .strict();
export type PutFilmTrailerReferencesInput = z.infer<
  typeof PutFilmTrailerReferencesSchema
>;

/** Service helper input: stored control + request bindings. */
export const ValidateFilmClipReferencePlanSchema = FilmClipReferencePlanSchema;

export const PutFilmClipDependenciesSchema = z
  .object({
    expectedProductionRevision: NonNegativeVersionSchema,
    dependencies: z.array(FilmClipDependencySpecSchema).max(500),
  })
  .strict()
  .superRefine((input, context) => {
    const pairs = new Set<string>();
    input.dependencies.forEach((dependency, index) => {
      const pair = `${dependency.predecessorClipId}:${dependency.successorClipId}:${dependency.kind}`;
      if (pairs.has(pair)) {
        context.addIssue({
          code: 'custom',
          path: ['dependencies', index],
          message: 'Duplicate clip dependency.',
        });
      }
      pairs.add(pair);
    });
  });
export type PutFilmClipDependenciesInput = z.infer<
  typeof PutFilmClipDependenciesSchema
>;

// ─── Reference slot, version, review, and approval requests ─────────────

export const CreateFilmReferenceSlotsBatchSchema = z
  .object({
    expectedProductionRevision: NonNegativeVersionSchema,
    slots: z.array(FilmReferenceSlotSpecSchema).min(1).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    const keys = new Set<string>();
    input.slots.forEach((slot, index) => {
      if (keys.has(slot.key)) {
        context.addIssue({
          code: 'custom',
          path: ['slots', index, 'key'],
          message: `Duplicate reference key ${slot.key}.`,
        });
      }
      keys.add(slot.key);
    });
  });
export type CreateFilmReferenceSlotsBatchInput = z.infer<
  typeof CreateFilmReferenceSlotsBatchSchema
>;

export const PutFilmReferenceSlotSchema = z
  .object({
    expectedVersion: NonNegativeVersionSchema,
    expectedProductionRevision: NonNegativeVersionSchema,
    slot: FilmReferenceSlotSpecSchema,
  })
  .strict();
export type PutFilmReferenceSlotInput = z.infer<
  typeof PutFilmReferenceSlotSchema
>;

const ReferenceVersionBaseSchema = z.object({
  expectedSlotVersion: NonNegativeVersionSchema,
  assetId: StoryUuidSchema,
  promptSnapshot: z.record(z.string(), z.unknown()).optional(),
  configSnapshot: z.record(z.string(), z.unknown()).optional(),
});

export const CreateFilmReferenceVersionSchema = z.discriminatedUnion('source', [
  ReferenceVersionBaseSchema.extend({ source: z.literal('upload') }).strict(),
  ReferenceVersionBaseSchema.extend({ source: z.literal('import') }).strict(),
  ReferenceVersionBaseSchema.extend({
    source: z.literal('ai_job'),
    aiJobId: StoryUuidSchema,
    aiJobOutputId: z.string().trim().min(1).max(180),
  }).strict(),
]);
export type CreateFilmReferenceVersionInput = z.infer<
  typeof CreateFilmReferenceVersionSchema
>;

export const CreateFilmReferenceReviewSchema = z
  .object({
    expectedReviewRevision: NonNegativeVersionSchema,
    decision: FilmReviewDecisionSchema,
    checklist: z
      .object({
        technical: ReviewChecklistValueSchema,
        identityContinuity: ReviewChecklistValueSchema,
        rights: ReviewChecklistValueSchema,
        safety: ReviewChecklistValueSchema,
      })
      .strict(),
    comment: z.string().trim().max(4_000).optional(),
  })
  .strict()
  .superRefine((review, context) => {
    requireReviewComment(review, context);
    if (
      review.decision === 'approve' &&
      (review.checklist.technical !== 'pass' ||
        review.checklist.rights !== 'pass' ||
        review.checklist.safety !== 'pass')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['checklist'],
        message: 'Technical, rights, and safety checks must pass to approve.',
      });
    }
  });
export type CreateFilmReferenceReviewInput = z.infer<
  typeof CreateFilmReferenceReviewSchema
>;

export const ApproveFilmReferenceVersionSchema = z
  .object({
    expectedSlotVersion: NonNegativeVersionSchema,
    expectedProductionRevision: NonNegativeVersionSchema,
    referenceVersionId: StoryUuidSchema,
    approveReviewId: StoryUuidSchema,
  })
  .strict();
export type ApproveFilmReferenceVersionInput = z.infer<
  typeof ApproveFilmReferenceVersionSchema
>;

// ─── Take, review, approval, and Master requests ────────────────────────

export const CreateFilmTakeSchema = z
  .object({
    expectedClipVersion: NonNegativeVersionSchema,
    /** Public AI catalog id (canonical slug, e.g. `seedance-2-0`). */
    modelId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .refine((value) => !StoryUuidSchema.safeParse(value).success, {
        message: 'modelId must be the public AI catalog slug, not a UUID.',
      })
      .optional(),
    variationNote: z.string().trim().max(2_000).optional(),
    /** BigInt-safe provider seed. */
    seed: z.string().trim().regex(/^\d+$/).max(40).optional(),
  })
  .strict();
export type CreateFilmTakeInput = z.infer<typeof CreateFilmTakeSchema>;

export const CreateDraftFilmTakeSchema = CreateFilmTakeSchema.omit({
  expectedClipVersion: true,
})
  .extend({ expectedDraftRevision: NonNegativeVersionSchema })
  .strict();
export type CreateDraftFilmTakeInput = z.infer<
  typeof CreateDraftFilmTakeSchema
>;

export const PrepareDraftFilmClipSchema = CreateDraftFilmTakeSchema.pick({
  expectedDraftRevision: true,
  modelId: true,
}).strict();
export type PrepareDraftFilmClipInput = z.infer<
  typeof PrepareDraftFilmClipSchema
>;

export interface PreparedDraftFilmClipDto {
  draftRevision: number;
  revisionId: string;
  productionRevision: number;
  clip: FilmClipSummaryDto;
}

export const CreateFilmTrailerTakeSchema = CreateFilmTakeSchema.omit({
  expectedClipVersion: true,
})
  .extend({ expectedTrailerVersion: NonNegativeVersionSchema })
  .strict();
export type CreateFilmTrailerTakeInput = z.infer<
  typeof CreateFilmTrailerTakeSchema
>;

export const CancelFilmTakeSchema = z
  .object({ expectedTakeVersion: NonNegativeVersionSchema })
  .strict();
export type CancelFilmTakeInput = z.infer<typeof CancelFilmTakeSchema>;

export const RetryFilmTakeSchema = z
  .object({
    expectedTakeVersion: NonNegativeVersionSchema,
    variationNote: z.string().trim().max(2_000).optional(),
  })
  .strict();
export type RetryFilmTakeInput = z.infer<typeof RetryFilmTakeSchema>;

export const CreateFilmTakeReviewSchema = z
  .object({
    expectedReviewRevision: NonNegativeVersionSchema,
    decision: FilmReviewDecisionSchema,
    checklist: FilmTakeReviewChecklistSchema,
    comment: z.string().trim().max(4_000).optional(),
  })
  .strict()
  .superRefine((review, context) => {
    requireReviewComment(review, context);
    if (
      review.decision === 'approve' &&
      (review.checklist.technical !== 'pass' ||
        review.checklist.safety !== 'pass')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['checklist'],
        message: 'Technical and safety checks must pass to approve.',
      });
    }
  });
export type CreateFilmTakeReviewInput = z.infer<
  typeof CreateFilmTakeReviewSchema
>;

export const CreateFilmTrailerTakeReviewSchema = z
  .object({
    expectedReviewRevision: NonNegativeVersionSchema,
    decision: FilmReviewDecisionSchema,
    checklist: FilmTrailerTakeReviewChecklistSchema,
    comment: z.string().trim().max(4_000).optional(),
  })
  .strict()
  .superRefine((review, context) => {
    requireReviewComment(review, context);
    if (
      review.decision === 'approve' &&
      !filmTrailerChecklistAllowsApproval(review.checklist)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['checklist'],
        message:
          'Trailer approval requires every mandatory editorial check to pass; text readability may be not applicable.',
      });
    }
  });
export type CreateFilmTrailerTakeReviewInput = z.infer<
  typeof CreateFilmTrailerTakeReviewSchema
>;

export function filmTrailerChecklistAllowsApproval(
  checklist: z.infer<typeof FilmTrailerTakeReviewChecklistSchema>,
): boolean {
  return (
    checklist.technical === 'pass' &&
    checklist.storyFidelity === 'pass' &&
    checklist.identityConsistency === 'pass' &&
    checklist.visualConsistency === 'pass' &&
    checklist.pacing === 'pass' &&
    (checklist.textReadability === 'pass' ||
      checklist.textReadability === 'na') &&
    checklist.rights === 'pass' &&
    checklist.safety === 'pass'
  );
}

export const ApproveFilmTakeSchema = z
  .object({
    expectedTakeVersion: NonNegativeVersionSchema,
    approveReviewId: StoryUuidSchema,
  })
  .strict();
export type ApproveFilmTakeInput = z.infer<typeof ApproveFilmTakeSchema>;

export const PutFilmClipMasterSchema = z
  .object({
    expectedMasterRevision: NonNegativeVersionSchema,
    expectedProductionRevision: NonNegativeVersionSchema,
    takeId: StoryUuidSchema.nullable(),
  })
  .strict();
export type PutFilmClipMasterInput = z.infer<typeof PutFilmClipMasterSchema>;

export const PutFilmTrailerMasterSchema = z
  .object({
    expectedMasterRevision: NonNegativeVersionSchema,
    takeId: StoryUuidSchema.nullable(),
  })
  .strict();
export type PutFilmTrailerMasterInput = z.infer<
  typeof PutFilmTrailerMasterSchema
>;

// ─── Build requests ─────────────────────────────────────────────────────

export const CreateFilmBuildSchema = z
  .object({
    revisionId: StoryUuidSchema,
    expectedProductionRevision: NonNegativeVersionSchema,
    profile: z.enum(['preview', 'production']),
    scope: FilmBuildScopeSchema,
  })
  .strict()
  .superRefine((build, context) => {
    if (build.profile === 'production' && build.scope.kind !== 'full') {
      context.addIssue({
        code: 'custom',
        path: ['scope'],
        message: 'Production builds must compile the full graph.',
      });
    }
  });
export type CreateFilmBuildInput = z.infer<typeof CreateFilmBuildSchema>;

export const CancelFilmBuildSchema = z
  .object({ expectedBuildVersion: NonNegativeVersionSchema })
  .strict();
export type CancelFilmBuildInput = z.infer<typeof CancelFilmBuildSchema>;

export const CreateFilmPreviewTokenSchema = z
  .object({
    expiresInSeconds: z
      .number()
      .int()
      .min(60)
      .max(24 * 60 * 60)
      .default(900),
  })
  .strict();
export type CreateFilmPreviewTokenInput = z.infer<
  typeof CreateFilmPreviewTokenSchema
>;

// ─── Immutable release, review, approval, and deployment requests ───────

export const CreateStoryReleaseSchema = z
  .object({
    expectedPublishRevision: NonNegativeVersionSchema,
    buildId: StoryUuidSchema,
    channel: StoryReleaseChannelSchema,
    releaseNotes: z.string().trim().max(4_000).optional(),
  })
  .strict();
export type CreateStoryReleaseInput = z.infer<typeof CreateStoryReleaseSchema>;

export const CreateStoryReleaseReviewSchema = z
  .object({
    expectedReviewRevision: NonNegativeVersionSchema,
    decision: FilmReviewDecisionSchema,
    checklist: z
      .object({
        runtimeValidation: ReviewChecklistValueSchema,
        pathCoverage: ReviewChecklistValueSchema,
        mediaIntegrity: ReviewChecklistValueSchema,
        moderation: ReviewChecklistValueSchema,
      })
      .strict(),
    comment: z.string().trim().max(4_000).optional(),
  })
  .strict()
  .superRefine((review, context) => {
    requireReviewComment(review, context);
    if (
      review.decision === 'approve' &&
      Object.values(review.checklist).some((value) => value !== 'pass')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['checklist'],
        message: 'All release checks must pass to approve.',
      });
    }
  });
export type CreateStoryReleaseReviewInput = z.infer<
  typeof CreateStoryReleaseReviewSchema
>;

export const ApproveStoryReleaseSchema = z
  .object({
    expectedPublishRevision: NonNegativeVersionSchema,
    approveReviewId: StoryUuidSchema,
  })
  .strict();
export type ApproveStoryReleaseInput = z.infer<
  typeof ApproveStoryReleaseSchema
>;

export const ActivateStoryReleaseSchema = z
  .object({
    expectedPublishRevision: NonNegativeVersionSchema,
    environment: StoryDeploymentEnvironmentSchema,
    expectedDeploymentVersion: NonNegativeVersionSchema.nullable(),
  })
  .strict();
export type ActivateStoryReleaseInput = z.infer<
  typeof ActivateStoryReleaseSchema
>;

export const OfflineStoryDeploymentSchema = z
  .object({
    environment: StoryDeploymentEnvironmentSchema,
    expectedDeploymentVersion: NonNegativeVersionSchema,
  })
  .strict();
export type OfflineStoryDeploymentInput = z.infer<
  typeof OfflineStoryDeploymentSchema
>;

function requireReviewComment(
  review: { decision: FilmReviewDecision; comment?: string },
  context: z.RefinementCtx,
): void {
  if (
    review.decision !== 'approve' &&
    (!review.comment || !review.comment.trim())
  ) {
    context.addIssue({
      code: 'custom',
      path: ['comment'],
      message: 'Reject and request_changes decisions require a comment.',
    });
  }
}

// ─── Response DTOs ──────────────────────────────────────────────────────

export interface CursorPageDto<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MediaAssetSummaryDto {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'document' | 'other';
  status: 'uploading' | 'ready' | 'failed' | 'deleted';
  moderationStatus: 'unreviewed' | 'approved' | 'flagged' | 'blocked';
  contentType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  checksumSha256: string | null;
  previewUrl: string | null;
}

export interface StoryRevisionSummaryDto {
  id: string;
  number: number;
  sourceDraftRevision: number;
  schemaVersion: string;
  contentHash: string;
  label: string | null;
  source: 'creator' | 'import';
  createdByUserId: string;
  createdAt: string;
}

export interface StoryDeploymentDto {
  environment: StoryDeploymentEnvironment;
  releaseId: string;
  status: StoryDeploymentStatus;
  version: number;
  deployedByUserId: string | null;
  deployedAt: string | null;
  offlinedByUserId: string | null;
  offlinedAt: string | null;
}

export interface StoryProjectProductionSummaryDto {
  referenceSlotCount: number;
  approvedReferenceCount: number;
  clipCount: number;
  approvedMasterCount: number;
  blockedClipCount: number;
  latestBuildStatus: FilmBuildStatus | null;
  nextBlocker: { code: string; message: string } | null;
}

export interface StoryProjectSummaryDto {
  id: string;
  workspaceId: string;
  format: StoryFormat;
  frameProfile: StoryFrameProfile;
  status: StoryProjectStatus;
  visibility: StoryVisibility;
  title: string;
  summary: string | null;
  defaultLocale: string;
  cover: MediaAssetSummaryDto | null;
  tags: string[];
  sourceIpId: string | null;
  projectVersion: number;
  draftRevision: number;
  activeRevision: StoryRevisionSummaryDto | null;
  publishRevision: number;
  deployments: StoryDeploymentDto[];
  production: StoryProjectProductionSummaryDto;
  capabilities: StoryCapability[];
  createdAt: string;
  updatedAt: string;
}

export interface StoryDraftDto {
  projectId: string;
  format: 'interactive_film';
  schemaVersion: typeof INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION;
  content: InteractiveFilmDraftContent;
  contentHash: string;
  revision: number;
  updatedByUserId: string;
  updatedBySessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryCanvasLayoutDto {
  projectId: string;
  schemaVersion: typeof STORY_CANVAS_LAYOUT_SCHEMA_VERSION;
  nodePositions: StoryCanvasNodePositions;
  revision: number;
  updatedByUserId: string;
  updatedBySessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryRevisionDto extends StoryRevisionSummaryDto {
  projectId: string;
  format: 'interactive_film';
  content: InteractiveFilmDraftContent;
}

export interface FilmSpecDto extends FilmSpec {
  projectId: string;
  revisionId: string;
  version: number;
  productionRevision: number;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface FilmDefaultModelDto {
  id: string;
  slug: string;
  displayName: string;
  generationModes: string[];
}

export type FilmClipProductionStatus =
  | 'blocked'
  | 'ready'
  | 'generating'
  | 'in_review'
  | 'approved'
  | 'stale';

export interface FilmClipMasterDto {
  takeId: string;
  status: FilmTakeStatus;
  outputAsset: MediaAssetSummaryDto | null;
  masterRevision: number;
  selectedByUserId: string;
  selectedAt: string;
}

export interface FilmClipReferenceBindingDto extends FilmClipReferenceBindingInput {
  id: string;
  approvedReferenceVersionId: string | null;
}

export interface FilmTrailerSummaryDto extends FilmTrailerSpec {
  id: string;
  projectId: string;
  revisionId: string;
  version: number;
  masterRevision: number;
  specHash: string;
  productionInputHash: string | null;
  productionStatus: FilmClipProductionStatus;
  blockReasons: Array<{ code: string; message: string }>;
  referenceBindings: FilmClipReferenceBindingDto[];
  master: FilmClipMasterDto | null;
  takeCounts: {
    total: number;
    running: number;
    ready: number;
    approved: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface FilmTrailerReferencesDto {
  trailerId: string;
  trailerVersion: number;
  masterRevision: number;
  bindings: FilmClipReferenceBindingDto[];
}

export interface FilmClipReferencesDto {
  clipId: string;
  clipVersion: number;
  productionRevision: number;
  bindings: FilmClipReferenceBindingDto[];
}

export interface FilmClipDependencyDto extends FilmClipDependencySpec {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FilmClipDto extends FilmClipSpec {
  id: string;
  projectId: string;
  revisionId: string;
  version: number;
  specHash: string;
  productionInputHash: string | null;
  productionStatus: FilmClipProductionStatus;
  blockReasons: Array<{ code: string; message: string }>;
  referenceBindings: FilmClipReferenceBindingDto[];
  incomingDependencies: FilmClipDependencyDto[];
  outgoingDependencies: FilmClipDependencyDto[];
  master: FilmClipMasterDto | null;
  takeCounts: {
    total: number;
    running: number;
    ready: number;
    approved: number;
  };
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FilmClipSummaryDto = Pick<
  FilmClipDto,
  | 'id'
  | 'key'
  | 'graphNodeId'
  | 'kind'
  | 'title'
  | 'description'
  | 'rank'
  | 'targetDurationMs'
  | 'generationControl'
  | 'prompt'
  | 'dialogueWindows'
  | 'outputContract'
  | 'continuityNotes'
  | 'version'
  | 'productionInputHash'
  | 'productionStatus'
  | 'blockReasons'
  | 'referenceBindings'
  | 'master'
  | 'takeCounts'
  | 'updatedAt'
>;

export interface FilmReferenceVersionDto {
  id: string;
  slotId: string;
  number: number;
  source: 'upload' | 'ai_job' | 'import' | 'take_frame';
  aiJobId: string | null;
  aiJobOutputId: string | null;
  sourceTakeId: string | null;
  sourceFrameIndex: number | null;
  sourceOutputChecksumSha256: string | null;
  asset: MediaAssetSummaryDto;
  promptSnapshot: Record<string, unknown> | null;
  configSnapshot: Record<string, unknown> | null;
  checksumSha256: string;
  reviewRevision: number;
  approved: boolean;
  createdByUserId: string;
  createdAt: string;
}

export interface FilmReferenceSlotDto extends FilmReferenceSlotSpec {
  id: string;
  projectId: string;
  revisionId: string;
  version: number;
  status: 'empty' | 'candidate' | 'approved' | 'invalidated';
  approvedVersionId: string | null;
  versions: FilmReferenceVersionDto[];
  createdAt: string;
  updatedAt: string;
}

export interface FilmTechnicalCheckDto {
  key: string;
  status: 'pending' | 'passed' | 'failed';
  message: string | null;
}

export interface FilmTakeDto {
  id: string;
  projectId: string;
  revisionId: string;
  clipId: string;
  number: number;
  version: number;
  aiJobId: string;
  aiJobOutputId: string | null;
  status: FilmTakeStatus;
  reviewStatus: 'unreviewed' | 'changes_requested' | 'approved' | 'rejected';
  reviewRevision: number;
  clipSpecHash: string;
  productionInputHash: string;
  promptSnapshot: Record<string, unknown>;
  generationConfig: Record<string, unknown>;
  modelSnapshot: Record<string, unknown>;
  stale: boolean;
  staleReasons: string[];
  outputAsset: MediaAssetSummaryDto | null;
  technicalChecks: FilmTechnicalCheckDto[];
  error: Record<string, unknown> | null;
  createdByUserId: string;
  queuedAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface FilmTrailerTakeDto extends Omit<
  FilmTakeDto,
  'clipId' | 'clipSpecHash'
> {
  trailerId: string;
  trailerSpecHash: string;
}

export interface FilmReviewDto {
  id: string;
  decision: FilmReviewDecision;
  checklist: Record<string, 'pass' | 'fail' | 'na'>;
  comment: string | null;
  reviewerUserId: string;
  createdAt: string;
}

export interface FilmBuildDiagnosticDto {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  entityType:
    | 'revision'
    | 'clip'
    | 'reference'
    | 'take'
    | 'choice'
    | 'ending'
    | 'asset'
    | null;
  entityId: string | null;
}

export interface FilmBuildPathReportDto {
  enumeratedPathCount: number;
  reachableEndingIds: string[];
  unreachableNodeIds: string[];
  ambiguousPathCount: number;
  durationMinMs: number;
  durationMaxMs: number;
}

export interface FrozenStoryAssetDto {
  logicalKey: string;
  assetId: string;
  variantId: string;
  checksumSha256: string;
  contentType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: string | null;
}

export interface FilmBuildAssetDto extends FrozenStoryAssetDto {
  id: string;
  buildId: string;
  clipId: string | null;
  role: string;
}

export interface FilmBuildDto {
  id: string;
  projectId: string;
  revisionId: string;
  number: number;
  version: number;
  profile: 'preview' | 'production';
  scope: FilmBuildScope;
  status: FilmBuildStatus;
  sourceProductionRevision: number;
  inputHash: string;
  inputManifestHash: string;
  runtimeSchemaVersion: 1;
  runtimeJson: Record<string, unknown> | null;
  runtimeHash: string | null;
  assets: FilmBuildAssetDto[];
  diagnostics: FilmBuildDiagnosticDto[];
  pathReport: FilmBuildPathReportDto | null;
  createdByUserId: string;
  createdAt: string;
  completedAt: string | null;
}

/** Ephemeral playtest compiled from the current saved authoring head. */
export interface StoryWorkingPreviewDto {
  draftRevision: number;
  contentHash: string;
  runtime: Record<string, unknown> | null;
  diagnostics: FilmBuildDiagnosticDto[];
  pathReport: FilmBuildPathReportDto | null;
  sources: Array<{
    graphNodeId: string;
    takeId: string;
    selection: 'master' | 'latest_ready';
  }>;
}

export type FilmBuildSummaryDto = Pick<
  FilmBuildDto,
  | 'id'
  | 'number'
  | 'profile'
  | 'scope'
  | 'status'
  | 'sourceProductionRevision'
  | 'diagnostics'
  | 'createdAt'
  | 'completedAt'
>;

export interface StoryReleaseDto {
  id: string;
  projectId: string;
  revisionId: string;
  buildId: string;
  format: StoryFormat;
  version: number;
  channel: StoryReleaseChannel;
  runtimeSchemaVersion: 1;
  runtimeJson: Record<string, unknown>;
  runtimeHash: string;
  manifestHash: string;
  metadata: Record<string, unknown>;
  assets: StoryReleaseAssetDto[];
  reviewRevision: number;
  approved: boolean;
  createdByUserId: string;
  createdAt: string;
}

export interface StoryReleaseAssetDto extends FrozenStoryAssetDto {
  id: string;
  releaseId: string;
  clipId: string | null;
  role: string;
}

/**
 * The most recent approved master video for a clip identity (`clipKey`),
 * resolved across ALL revisions. It lets the canvas keep showing a shot's
 * generated video after the draft is edited into a new revision, instead of
 * blanking out — the video is flagged as carried over so the author knows it
 * predates their latest edits. Display-only: builds/releases never read this
 * and stay bound to the selected revision's own master.
 */
export interface FilmCarriedMasterDto {
  clipKey: string;
  takeId: string;
  revisionNumber: number;
  outputAsset: MediaAssetSummaryDto | null;
  selectedAt: string | null;
}

export interface StoryWorkbenchDto {
  project: StoryProjectSummaryDto;
  draft: StoryDraftDto;
  selectedRevision: StoryRevisionDto | null;
  film: {
    productionRevision: number;
    spec: FilmSpecDto | null;
    defaultModel: FilmDefaultModelDto | null;
    trailer: FilmTrailerSummaryDto | null;
    clips: FilmClipSummaryDto[];
    references: FilmReferenceSlotDto[];
    latestBuild: FilmBuildSummaryDto | null;
    carriedMasters: FilmCarriedMasterDto[];
  } | null;
}

export interface StoryDraftConflictDto {
  code: 'DRAFT_REVISION_CONFLICT';
  expectedRevision: number;
  actualRevision: number;
  current: StoryDraftDto;
}

export interface StoryCanvasLayoutConflictDto {
  code: 'CANVAS_LAYOUT_REVISION_CONFLICT';
  expectedRevision: number;
  actualRevision: number;
  current: StoryCanvasLayoutDto;
}

export interface ResourceVersionConflictDto {
  code: 'RESOURCE_VERSION_CONFLICT';
  resourceType: string;
  resourceId: string;
  expectedVersion: number;
  actualVersion: number;
}
