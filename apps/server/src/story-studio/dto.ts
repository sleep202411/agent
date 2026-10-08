import { STORY_CHAPTER_NODES_MAX } from '@repo/shared/story-production';
import {
  ExperienceAppearanceSchema,
  GameUISourceSchema,
  type GameUIProject,
  type ExperienceAppearance,
} from '@repo/shared/experience-runtime';
import { z } from 'zod';
import {
  STORY_VISUAL_STYLE_SKILL_SLUGS,
  type StoryVisualStyleSkillSlug,
} from '@repo/shared';
import {
  StoryBuildScopeSchema,
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  InteractiveStoryDraftContentSchema,
  ReviewChecklistValueSchema,
  StoryLocaleSchema,
  StoryReferenceReviewDecisionSchema,
  StoryReferenceSlotSpecSchema,
  StoryStableIdSchema,
  StoryUuidSchema,
  type StoryBuildScope,
  type StoryBuildStatus,
  type InteractiveStoryDraftContent,
  type StoryReferenceReviewDecision,
  type StoryReferenceSlotSpec,
} from './interactive-film.schema';
export * from './interactive-film.schema';

/** Product-level contracts for interactive-film production. */

export const STORY_TITLE_MAX = 160;
export const STORY_SUMMARY_MAX = 2_000;
export const STORY_TAG_MAX = 40;
export const STORY_TAG_COUNT_MAX = 12;
export const STORY_CHAPTER_COUNT_MAX = 200;
export const STORY_CHAPTER_NODE_COUNT_MAX = STORY_CHAPTER_NODES_MAX;
export const STORY_CANVAS_LAYOUT_SCHEMA_VERSION =
  'story-canvas-layout-v3' as const;
export const STORY_CANVAS_LAYOUT_NODE_COUNT_MAX = 20_000;
export const STORY_CANVAS_LAYOUT_COORDINATE_ABS_MAX = 10_000_000;

export const StoryProjectStatusSchema = z.enum(['active', 'archived']);
export type StoryProjectStatus = z.infer<typeof StoryProjectStatusSchema>;

export const StoryFrameProfileSchema = z.enum([
  'landscape_16_9',
  'portrait_9_16',
]);
export type StoryFrameProfile = z.infer<typeof StoryFrameProfileSchema>;

export const StoryDurationPresetSchema = z.enum([
  'short_5_15',
  'medium_15_30',
  'long_30_60',
]);
export type StoryDurationPreset = z.infer<typeof StoryDurationPresetSchema>;

export const StoryVisualStyleSchema = z.enum(STORY_VISUAL_STYLE_SKILL_SLUGS);
export type StoryVisualStyle = StoryVisualStyleSkillSlug;

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

export const StoryCandidateAssetParamsSchema = z
  .object({
    projectId: StoryUuidSchema,
    mediaAssetId: StoryUuidSchema,
  })
  .strict();
export type StoryCandidateAssetParams = z.infer<
  typeof StoryCandidateAssetParamsSchema
>;

export const StoryChapterParamsSchema = z
  .object({ projectId: StoryUuidSchema, chapterId: StoryUuidSchema })
  .strict();
export type StoryChapterParams = z.infer<typeof StoryChapterParamsSchema>;

export const StoryRevisionParamsSchema = z
  .object({ projectId: StoryUuidSchema, revisionId: StoryUuidSchema })
  .strict();
export type StoryRevisionParams = z.infer<typeof StoryRevisionParamsSchema>;

export const StoryClipVideoParamsSchema = z
  .object({
    projectId: StoryUuidSchema,
    graphNodeId: StoryStableIdSchema,
  })
  .strict();
export type StoryClipVideoParams = z.infer<typeof StoryClipVideoParamsSchema>;

export const StoryReferenceSlotParamsSchema = z
  .object({
    projectId: StoryUuidSchema,
    slotId: StoryUuidSchema,
  })
  .strict();
export type StoryReferenceSlotParams = z.infer<
  typeof StoryReferenceSlotParamsSchema
>;

export const StoryReferenceVersionParamsSchema = z
  .object({
    projectId: StoryUuidSchema,
    slotId: StoryUuidSchema,
    referenceVersionId: StoryUuidSchema,
  })
  .strict();
export type StoryReferenceVersionParams = z.infer<
  typeof StoryReferenceVersionParamsSchema
>;

export const StoryBuildParamsSchema = z
  .object({ projectId: StoryUuidSchema, buildId: StoryUuidSchema })
  .strict();
export type StoryBuildParams = z.infer<typeof StoryBuildParamsSchema>;

export const StoryBuildAssetParamsSchema = z
  .object({
    projectId: StoryUuidSchema,
    buildId: StoryUuidSchema,
    assetId: StoryUuidSchema,
    variantId: StoryUuidSchema,
  })
  .strict();
export type StoryBuildAssetParams = z.infer<typeof StoryBuildAssetParamsSchema>;

export const StoryProjectListQuerySchema = z
  .object({
    linkedIpId: StoryUuidSchema.optional(),
    workspaceId: StoryUuidSchema,
    status: StoryProjectStatusSchema.default('active'),
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type StoryProjectListQuery = z.infer<typeof StoryProjectListQuerySchema>;

export const StoryWorkbenchQuerySchema = z
  .object({ chapterId: StoryUuidSchema.optional() })
  .strict();
export type StoryWorkbenchQuery = z.infer<typeof StoryWorkbenchQuerySchema>;

export const StoryRevisionListQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type StoryRevisionListQuery = z.infer<
  typeof StoryRevisionListQuerySchema
>;

export const StoryBuildListQuerySchema = z
  .object({
    kind: z.enum(['preview', 'production']).optional(),
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type StoryBuildListQuery = z.infer<typeof StoryBuildListQuerySchema>;

// ─── Core project, draft, and immutable revision requests ───────────────

export const CreateStoryProjectSchema = z
  .object({
    workspaceId: StoryUuidSchema,
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

/**
 * Publication introduction draft — v1 single-locale. Incomplete text can
 * be saved; completeness is checked before review. `null` clears the draft.
 * Media fields reference the
 * project's candidate assets (ids), public URLs are resolved server-side at
 * read time. Text structure may upgrade to record(locale→string) later.
 */
export const StoreListingSchema = z
  .object({
    description: z.string().trim().max(13000),
    tags: z
      .array(z.string().trim().min(1).max(40))
      .max(12)
      .refine((tags) => new Set(tags).size === tags.length, {
        message: 'Tags must not contain duplicates.',
      }),
    developer: z.string().trim().max(60),
    trailerAssetId: StoryUuidSchema.nullable(),
    screenshotAssetIds: z
      .array(StoryUuidSchema)
      .max(8)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Screenshot assets must not contain duplicates.',
      }),
  })
  .strict();
export type StoreListing = z.infer<typeof StoreListingSchema>;

/** Read saved introduction formats without discarding text or labels. */
const LegacyTextStoreListingSchema = StoreListingSchema.omit({
  description: true,
}).extend({
  tagline: z.string().trim().max(120),
  shortDescription: z.string().trim().max(300),
  aboutParagraphs: z.array(z.string().trim().max(2000)).max(6),
});

const LegacyStoredTextStoreListingSchema =
  LegacyTextStoreListingSchema.transform(
    ({ tagline, shortDescription, aboutParagraphs, ...listing }) => ({
      ...listing,
      description: combineStoredDescription(
        tagline,
        shortDescription,
        aboutParagraphs,
      ),
    }),
  ).pipe(StoreListingSchema);

const LegacyStoredStoreListingSchema = LegacyTextStoreListingSchema.extend({
  genres: z
    .array(z.string().trim().min(1).max(40))
    .max(4)
    .refine((genres) => new Set(genres).size === genres.length, {
      message: 'Genres must not contain duplicates.',
    }),
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(8)
    .refine((tags) => new Set(tags).size === tags.length, {
      message: 'Tags must not contain duplicates.',
    }),
})
  .transform(
    ({
      genres,
      tags,
      tagline,
      shortDescription,
      aboutParagraphs,
      ...listing
    }) => ({
      ...listing,
      description: combineStoredDescription(
        tagline,
        shortDescription,
        aboutParagraphs,
      ),
      tags: [...new Set([...genres, ...tags])],
    }),
  )
  .pipe(StoreListingSchema);

export const StoredStoreListingSchema = z.union([
  StoreListingSchema,
  LegacyStoredTextStoreListingSchema,
  LegacyStoredStoreListingSchema,
]);

function combineStoredDescription(
  tagline: string,
  shortDescription: string,
  aboutParagraphs: string[],
): string {
  return [tagline, shortDescription, ...aboutParagraphs]
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n\n');
}

export const PatchStoryProjectSchema = z
  .object({
    expectedProjectVersion: NonNegativeVersionSchema,
    title: StoryTitleSchema.optional(),
    summary: StorySummarySchema.optional(),
    coverAssetId: StoryUuidSchema.nullable().optional(),
    defaultLocale: z.string().trim().min(2).max(16).optional(),
    visibility: StoryVisibilitySchema.optional(),
    tags: StoryTagsSchema.optional(),
    storeListing: StoreListingSchema.nullable().optional(),
    appearance: ExperienceAppearanceSchema.nullable().optional(),
    gameUiSource: GameUISourceSchema.nullable().optional(),
    frameProfile: StoryFrameProfileSchema.optional(),
    durationPreset: StoryDurationPresetSchema.optional(),
    visualStyle: StoryVisualStyleSchema.optional(),
    /**
     * A creator confirms the complete profile atomically. The server owns the
     * timestamp; clients cannot file partial or silently-defaulted direction.
     */
    confirmCreativeProfile: z.literal(true).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const touchesCreativeProfile =
      value.frameProfile !== undefined ||
      value.durationPreset !== undefined ||
      value.visualStyle !== undefined ||
      value.confirmCreativeProfile !== undefined;
    if (
      touchesCreativeProfile &&
      (value.frameProfile === undefined ||
        value.durationPreset === undefined ||
        value.visualStyle === undefined ||
        value.confirmCreativeProfile !== true)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['confirmCreativeProfile'],
        message:
          'Confirm frameProfile, durationPreset, and visualStyle together as one creative profile.',
      });
    }
  })
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

export const CreateStoryChapterSchema = z
  .object({ title: StoryTitleSchema })
  .strict();
export type CreateStoryChapterInput = z.infer<typeof CreateStoryChapterSchema>;

export const PatchStoryChapterSchema = z
  .object({ title: StoryTitleSchema })
  .strict();
export type PatchStoryChapterInput = z.infer<typeof PatchStoryChapterSchema>;

export const ReorderStoryChaptersSchema = z
  .object({
    expectedProjectVersion: NonNegativeVersionSchema,
    chapterIds: z
      .array(StoryUuidSchema)
      .min(1)
      .max(STORY_CHAPTER_COUNT_MAX)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Chapter order must not contain duplicates.',
      }),
  })
  .strict();
export type ReorderStoryChaptersInput = z.infer<
  typeof ReorderStoryChaptersSchema
>;

export const PutStoryDraftSchema = z
  .object({
    expectedRevision: NonNegativeVersionSchema,
    schemaVersion: z.literal(INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION),
    content: InteractiveStoryDraftContentSchema,
    sessionId: SessionIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    value.content.graph.nodes.forEach((node, index) => {
      if (node.kind === 'decision' && node.exit.kind !== 'choice') {
        context.addIssue({
          code: 'custom',
          path: ['content', 'graph', 'nodes', index, 'exit'],
          message:
            'An editable decision node must retain its choice definition.',
        });
      }
    });
  })
  .refine(
    (value) => value.content.graph.nodes.length <= STORY_CHAPTER_NODE_COUNT_MAX,
    {
      path: ['content', 'graph', 'nodes'],
      message: `A chapter supports at most ${STORY_CHAPTER_NODE_COUNT_MAX} nodes.`,
    },
  );
export type PutStoryDraftInput = z.infer<typeof PutStoryDraftSchema>;

export const ImportStoryPlotSchema = z
  .object({
    expectedRevision: NonNegativeVersionSchema,
    schemaVersion: z.literal(INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION),
    content: InteractiveStoryDraftContentSchema,
    sessionId: SessionIdSchema,
    locale: StoryLocaleSchema,
    mode: z.enum(['append', 'replace']),
    plot: z.unknown(),
    media: z
      .array(
        z
          .object({
            nodeId: z.string().min(1).max(64),
            clipId: z.string().min(1).max(64),
            mediaAssetId: z.uuid(),
          })
          .strict(),
      )
      .max(100_000)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    value.content.graph.nodes.forEach((node, index) => {
      if (node.kind === 'decision' && node.exit.kind !== 'choice') {
        context.addIssue({
          code: 'custom',
          path: ['content', 'graph', 'nodes', index, 'exit'],
          message:
            'An editable decision node must retain its choice definition.',
        });
      }
    });
  });
export type ImportStoryPlotInput = z.infer<typeof ImportStoryPlotSchema>;

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

// ─── Reference slot, version, review, and approval requests ─────────────

export const CreateStoryReferenceSlotsBatchSchema = z
  .object({
    slots: z.array(StoryReferenceSlotSpecSchema).min(1).max(100),
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
export type CreateStoryReferenceSlotsBatchInput = z.infer<
  typeof CreateStoryReferenceSlotsBatchSchema
>;

export const PutStoryReferenceSlotSchema = z
  .object({
    expectedSlotVersion: NonNegativeVersionSchema,
    slot: StoryReferenceSlotSpecSchema,
  })
  .strict();
export type PutStoryReferenceSlotInput = z.infer<
  typeof PutStoryReferenceSlotSchema
>;

const ReferenceVersionBaseSchema = z.object({
  expectedSlotVersion: NonNegativeVersionSchema,
  assetId: StoryUuidSchema,
  variantId: StoryUuidSchema,
  sourceRecipeSnapshot: z.record(z.string(), z.unknown()).optional(),
});

export const CreateStoryReferenceVersionSchema = z.discriminatedUnion(
  'source',
  [
    ReferenceVersionBaseSchema.extend({ source: z.literal('upload') }).strict(),
    ReferenceVersionBaseSchema.extend({ source: z.literal('import') }).strict(),
    ReferenceVersionBaseSchema.extend({
      source: z.literal('ai_job'),
      aiJobId: StoryUuidSchema,
      aiJobOutputId: z.string().trim().min(1).max(180),
    }).strict(),
  ],
);
export type CreateStoryReferenceVersionInput = z.infer<
  typeof CreateStoryReferenceVersionSchema
>;

export const CreateStoryReferenceReviewSchema = z
  .object({
    expectedReviewRevision: NonNegativeVersionSchema,
    decision: StoryReferenceReviewDecisionSchema,
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
export type CreateStoryReferenceReviewInput = z.infer<
  typeof CreateStoryReferenceReviewSchema
>;

export const ApproveStoryReferenceVersionSchema = z
  .object({
    expectedSlotVersion: NonNegativeVersionSchema,
    referenceVersionId: StoryUuidSchema,
    approveReviewId: StoryUuidSchema,
  })
  .strict();
export type ApproveStoryReferenceVersionInput = z.infer<
  typeof ApproveStoryReferenceVersionSchema
>;

// ─── Build requests ─────────────────────────────────────────────────────

export const CreateStoryBuildSchema = z
  .object({
    // Both tokens are optional: omit them to build whatever is saved right now.
    // They exist for a caller that wants "build exactly the state I was looking
    // at, or tell me it moved" — which is worth having, but making every caller
    // fetch and carry two version values to press Build is not. A Build is
    // immutable, numbered and cheap, and the author play-tests it immediately,
    // so a Build of the wrong moment costs one more Build.
    expectedDraftRevision: NonNegativeVersionSchema.optional(),
    expectedVideoSnapshotHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    scope: StoryBuildScopeSchema,
    // Publishability is an intent, not a shape. A multi-chapter work cannot
    // compile to one full-scope manifest at all — each chapter is an immutable,
    // independently built film with its own entry and natural completion. Such
    // a work therefore
    // publishes one manifest PER CHAPTER, and each of those is a subgraph;
    // what the release API receives is the Game Manifest listing those
    // per-chapter manifest URLs, never a composed manifest.
    // Omitted keeps the historical default: full ⇒ production, subgraph ⇒
    // preview. A chapter Build stays `preview` in practice, because
    // `story_builds_production_scope_chk` admits only full-scope Builds as
    // `production`; the release candidate compiler therefore verifies chapter Builds
    // itself rather than trusting the kind.
    kind: z.enum(['preview', 'production']).optional(),
  })
  .strict();
export type CreateStoryBuildInput = z.infer<typeof CreateStoryBuildSchema>;

export const CancelStoryBuildSchema = z
  .object({ expectedBuildVersion: NonNegativeVersionSchema })
  .strict();
export type CancelStoryBuildInput = z.infer<typeof CancelStoryBuildSchema>;

export const PrepareStoryExperienceReleaseSchema = z
  .object({
    expectedProjectVersion: NonNegativeVersionSchema,
    expectedDraftRevision: NonNegativeVersionSchema,
    expectedVideoSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type PrepareStoryExperienceReleaseInput = z.infer<
  typeof PrepareStoryExperienceReleaseSchema
>;

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

function requireReviewComment(
  review: { decision: StoryReferenceReviewDecision; comment?: string },
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

export interface StoryCandidateAssetVideoVariantDto {
  id: string;
  variantKey: string;
  contentType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  checksumSha256: string | null;
}

export interface StoryCandidateAssetDto {
  asset: MediaAssetSummaryDto;
  videoVariant: StoryCandidateAssetVideoVariantDto | null;
  addedByUserId: string;
  addedAt: string;
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

export interface StoryProjectProductionSummaryDto {
  referenceSlotCount: number;
  approvedReferenceCount: number;
  clipCount: number;
  currentVideoCount: number;
  latestBuildStatus: StoryBuildStatus | null;
}

/**
 * Which tenant a project lives in, for a caller who arrived on a shared link
 * and therefore has no workspace to scope by yet. The id is the whole payload:
 * the studio switches by id and reads the workspace's name and type from its
 * own membership list, so echoing them here would hand out tenant metadata the
 * switch never reads.
 */
export interface StoryProjectWorkspaceRefDto {
  workspaceId: string;
}

export interface StoryProjectSummaryDto {
  canMove: boolean;
  id: string;
  workspaceId: string;
  frameProfile: StoryFrameProfile;
  frameProfileMutable: boolean;
  durationPreset: StoryDurationPreset | null;
  visualStyle: StoryVisualStyle | null;
  creativeProfileConfirmedAt: string | null;
  status: StoryProjectStatus;
  visibility: StoryVisibility;
  title: string;
  summary: string | null;
  defaultLocale: string;
  cover: MediaAssetSummaryDto | null;
  tags: string[];
  /** Publication introduction draft; null when unset. */
  storeListing: StoreListing | null;
  appearance: ExperienceAppearance | null;
  gameUi: GameUIProject | null;
  sourceIpId: string | null;
  projectVersion: number;
  draftRevision: number;
  activeRevision: StoryRevisionSummaryDto | null;
  production: StoryProjectProductionSummaryDto;
  capabilities: StoryCapability[];
  createdAt: string;
  updatedAt: string;
}

export interface StoryChapterDto {
  id: string;
  projectId: string;
  title: string;
  rank: number;
  entryNodeId: string | null;
  nodeCount: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryDraftDto {
  projectId: string;
  /** Null only on project-wide immutable-revision conflict payloads. */
  chapterId: string | null;
  schemaVersion: typeof INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION;
  content: InteractiveStoryDraftContent;
  contentHash: string;
  revision: number;
  updatedByUserId: string;
  updatedBySessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryCanvasLayoutDto {
  projectId: string;
  chapterId: string;
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
  content: InteractiveStoryDraftContent;
}

export interface StoryReferenceVersionDto {
  id: string;
  slotId: string;
  number: number;
  source: 'upload' | 'ai_job' | 'import';
  aiJobId: string | null;
  aiJobOutputId: string | null;
  asset: MediaAssetSummaryDto;
  variantId: string;
  sourceRecipeSnapshot: Record<string, unknown> | null;
  checksumSha256: string;
  reviewRevision: number;
  approved: boolean;
  createdByUserId: string;
  createdAt: string;
}

export interface StoryReferenceSlotDto extends StoryReferenceSlotSpec {
  id: string;
  projectId: string;
  version: number;
  status: 'empty' | 'candidate' | 'approved' | 'invalidated';
  approvedVersionId: string | null;
  versions: StoryReferenceVersionDto[];
  createdAt: string;
  updatedAt: string;
}

/** Review projection for reference-version approval. */
export interface StoryReferenceReviewDto {
  id: string;
  decision: StoryReferenceReviewDecision;
  checklist: Record<string, 'pass' | 'fail' | 'na'>;
  comment: string | null;
  reviewerUserId: string;
  createdAt: string;
}

export interface StoryBuildDiagnosticDto {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  entityType:
    | 'revision'
    | 'node'
    | 'clip'
    | 'reference'
    | 'choice'
    | 'asset'
    | null;
  entityId: string | null;
  chapterId?: string;
  details?: StoryBuildDiagnosticDetails;
}

/** Structured fields the playtest screen turns into a sentence. The English
 * `message` stays as the fallback for clients that do not know `kind`. */
export type StoryBuildDiagnosticDetails =
  | {
      kind: 'state-effect-type';
      nodeTitle: string;
      choiceLabel: string | null;
      effectIndex: number;
      variableName: string;
      operation: 'add' | 'set';
      variableType: 'number' | 'boolean';
    }
  | {
      kind: 'shot';
      sceneTitle: string;
      shotTitle: string;
    }
  | {
      kind: 'missing-sequence';
      sceneTitle: string;
    }
  | {
      kind: 'duplicate-playback';
      playbackId: string;
      shots: Array<{ sceneTitle: string; shotTitle: string }>;
    };

export interface StoryBuildPathReportDto {
  enumeratedPathCount: number;
  reachableTerminalNodeIds: string[];
  unreachableNodeIds: string[];
  ambiguousPathCount: number;
  durationMinMs: number;
  durationMaxMs: number;
}

export interface FrozenStoryAssetDto {
  logicalKey: string;
  assetId: string;
  variantId: string;
  checksumSha256: string | null;
  contentType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  browserSafeMp4: boolean | null;
  sizeBytes: string | null;
}

export interface StoryBuildAssetDto extends FrozenStoryAssetDto {
  id: string;
  buildId: string;
  graphNodeId: string | null;
  role: string;
}

export interface StoryBuildDto {
  id: string;
  projectId: string;
  number: number;
  version: number;
  kind: 'preview' | 'production';
  scope: StoryBuildScope;
  status: StoryBuildStatus;
  sourceDraftRevision: number;
  videoSnapshotHash: string;
  inputHash: string;
  inputManifestHash: string;
  runtimeSchemaVersion: 2;
  runtimeJson: Record<string, unknown> | null;
  runtimeHash: string | null;
  assets: StoryBuildAssetDto[];
  diagnostics: StoryBuildDiagnosticDto[];
  pathReport: StoryBuildPathReportDto | null;
  createdByUserId: string;
  createdAt: string;
  completedAt: string | null;
}

/** Ephemeral playtest compiled from the current saved authoring head. */
export interface StoryWorkingPreviewDto {
  draftRevision: number;
  contentHash: string;
  videoSnapshotHash: string | null;
  runtimeSchemaVersion: 2;
  runtime: Record<string, unknown> | null;
  coverUrl: string | null;
  diagnostics: StoryBuildDiagnosticDto[];
  pathReport: StoryBuildPathReportDto | null;
  sources: Array<{
    graphNodeId: string;
    assetId: string;
    variantId: string;
    selectionVersion: number;
    selection: 'current';
  }>;
}

export type StoryBuildSummaryDto = Pick<
  StoryBuildDto,
  | 'id'
  | 'number'
  | 'kind'
  | 'scope'
  | 'status'
  | 'sourceDraftRevision'
  | 'videoSnapshotHash'
  | 'diagnostics'
  | 'createdAt'
  | 'completedAt'
>;

export interface StoryWorkbenchDto {
  project: StoryProjectSummaryDto;
  chapters: StoryChapterDto[];
  chapter: StoryChapterDto;
  draft: StoryDraftDto;
  script: {
    documentId: string | null;
    currentSequence: number;
    sourceVersionId: string | null;
    sourceSequence: number | null;
    status: 'missing' | 'current' | 'stale' | 'unlinked';
  };
  video: {
    snapshotHash: string;
  };
  references: StoryReferenceSlotDto[];
  latestBuild: StoryBuildSummaryDto | null;
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
