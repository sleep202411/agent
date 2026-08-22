import { z } from 'zod';

const StoryProductionUuidSchema = z.uuid();
const StoryProductionVersionSchema = z.number().int().nonnegative();
const StoryProductionTextSchema = (maximum: number) =>
  z.string().trim().min(1).max(maximum);

export const StoryProductionChapterParamsSchema = z
  .object({
    projectId: StoryProductionUuidSchema,
    chapterId: StoryProductionUuidSchema,
  })
  .strict();
export type StoryProductionChapterParams = z.infer<
  typeof StoryProductionChapterParamsSchema
>;

export const StoryAssetSpecParamsSchema =
  StoryProductionChapterParamsSchema.extend({
    assetSpecId: StoryProductionUuidSchema,
  }).strict();
export type StoryAssetSpecParams = z.infer<typeof StoryAssetSpecParamsSchema>;

export const StoryStoryboardSequenceParamsSchema =
  StoryProductionChapterParamsSchema.extend({
    sequenceId: StoryProductionUuidSchema,
  }).strict();
export type StoryStoryboardSequenceParams = z.infer<
  typeof StoryStoryboardSequenceParamsSchema
>;

export const StoryStoryboardClipParamsSchema =
  StoryProductionChapterParamsSchema.extend({
    sequenceId: StoryProductionUuidSchema,
    clipId: StoryProductionUuidSchema,
  }).strict();
export type StoryStoryboardClipParams = z.infer<
  typeof StoryStoryboardClipParamsSchema
>;

export const StoryStoryboardBindingParamsSchema =
  StoryStoryboardClipParamsSchema.extend({
    assetSpecId: StoryProductionUuidSchema,
  }).strict();
export type StoryStoryboardBindingParams = z.infer<
  typeof StoryStoryboardBindingParamsSchema
>;

export const StoryStoryboardCueParamsSchema =
  StoryStoryboardSequenceParamsSchema.extend({
    cueId: StoryProductionUuidSchema,
  }).strict();
export type StoryStoryboardCueParams = z.infer<
  typeof StoryStoryboardCueParamsSchema
>;

export const ResolveStoryProductionConflictSchema = z
  .object({
    expectedVersion: StoryProductionVersionSchema,
    expectedPendingSourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    resolution: z.enum(['keep_current', 'use_latest_plan']),
  })
  .strict();
export type ResolveStoryProductionConflictInput = z.infer<
  typeof ResolveStoryProductionConflictSchema
>;

export const PatchStoryAssetSpecSchema = z
  .object({
    expectedVersion: StoryProductionVersionSchema,
    name: StoryProductionTextSchema(240).optional(),
    description: z.string().trim().max(4_000).nullable().optional(),
    imagePrompt: StoryProductionTextSchema(12_000).optional(),
    videoPrompt: StoryProductionTextSchema(12_000).nullable().optional(),
    negativePrompt: StoryProductionTextSchema(4_000).nullable().optional(),
    selectedMediaVersionId: StoryProductionUuidSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'expectedVersion'),
    {
      message: 'At least one Asset Spec field must be updated.',
    },
  );
export type PatchStoryAssetSpecInput = z.infer<
  typeof PatchStoryAssetSpecSchema
>;

export const PatchStoryStoryboardSequenceSchema = z
  .object({
    expectedVersion: StoryProductionVersionSchema,
    title: StoryProductionTextSchema(240).nullable().optional(),
    description: z.string().trim().max(4_000).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'expectedVersion'),
    {
      message: 'At least one Storyboard sequence field must be updated.',
    },
  );
export type PatchStoryStoryboardSequenceInput = z.infer<
  typeof PatchStoryStoryboardSequenceSchema
>;

const StoryStoryboardTimelineClipBaseSchema = z
  .object({
    /** Omit only when creating a brand-new clip in this atomic timeline. */
    id: StoryProductionUuidSchema.optional(),
    /** Existing clips require an exact CAS; new clips must use zero. */
    expectedVersion: StoryProductionVersionSchema,
    stableKey: StoryProductionTextSchema(120),
    title: StoryProductionTextSchema(160),
    startMs: z.number().int().min(0).max(3_600_000),
    durationMs: z.number().int().min(250).max(3_600_000),
    description: z.string().trim().max(4_000).nullable(),
    negativePrompt: StoryProductionTextSchema(4_000).nullable(),
  })
  .strict();

const StoryStoryboardTimelineClipSchema = z.discriminatedUnion('kind', [
  StoryStoryboardTimelineClipBaseSchema.extend({
    kind: z.literal('image'),
    imagePrompt: StoryProductionTextSchema(12_000),
    videoPrompt: z.null(),
  }).strict(),
  StoryStoryboardTimelineClipBaseSchema.extend({
    kind: z.literal('video'),
    // A video clip carries only its own kind's prompt; a held opening frame
    // is its own image clip.
    imagePrompt: z.null(),
    videoPrompt: StoryProductionTextSchema(12_000),
  }).strict(),
]);

/**
 * Complete single-visual-track replacement. The all-at-once command is the
 * only safe way to edit timeline coordinates while the database enforces
 * continuous coverage with a deferred constraint trigger.
 */
export const PutStoryStoryboardTimelineSchema = z
  .object({
    expectedVersion: StoryProductionVersionSchema,
    durationMs: z.number().int().min(250).max(3_600_000),
    clips: z.array(StoryStoryboardTimelineClipSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    const stableKeys = new Set<string>();
    let cursor = 0;
    for (const [index, clip] of value.clips.entries()) {
      if (!clip.id && clip.expectedVersion !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['clips', index, 'expectedVersion'],
          message: 'A new Storyboard clip must use expectedVersion 0.',
        });
      }
      if (clip.id && ids.has(clip.id)) {
        context.addIssue({
          code: 'custom',
          path: ['clips', index, 'id'],
          message: 'A Storyboard clip id can appear only once in a timeline.',
        });
      }
      if (stableKeys.has(clip.stableKey)) {
        context.addIssue({
          code: 'custom',
          path: ['clips', index, 'stableKey'],
          message:
            'A Storyboard clip stable key can appear only once in a timeline.',
        });
      }
      if (clip.startMs !== cursor) {
        context.addIssue({
          code: 'custom',
          path: ['clips', index, 'startMs'],
          message: `Visual clips must be ordered and continuous; expected startMs ${cursor}.`,
        });
      }
      if (clip.id) ids.add(clip.id);
      stableKeys.add(clip.stableKey);
      cursor = clip.startMs + clip.durationMs;
    }
    if (cursor !== value.durationMs) {
      context.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message:
          'Sequence duration must equal the end of its continuous visual clips.',
      });
    }
  });
export type PutStoryStoryboardTimelineInput = z.infer<
  typeof PutStoryStoryboardTimelineSchema
>;

export const PatchStoryStoryboardClipSchema = z
  .object({
    expectedVersion: StoryProductionVersionSchema,
    title: StoryProductionTextSchema(160).optional(),
    description: z.string().trim().max(4_000).nullable().optional(),
    imagePrompt: StoryProductionTextSchema(12_000).nullable().optional(),
    videoPrompt: StoryProductionTextSchema(12_000).nullable().optional(),
    negativePrompt: StoryProductionTextSchema(4_000).nullable().optional(),
    selectedMediaVersionId: StoryProductionUuidSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'expectedVersion'),
    {
      message: 'At least one Storyboard clip field must be updated.',
    },
  );
export type PatchStoryStoryboardClipInput = z.infer<
  typeof PatchStoryStoryboardClipSchema
>;

export const PutStoryStoryboardBindingSchema = z
  .object({
    /** Zero creates a new binding; existing bindings require an exact CAS. */
    expectedVersion: StoryProductionVersionSchema,
    role: StoryProductionTextSchema(64).default('reference'),
    mode: z.enum(['follow_selected', 'pinned']),
    pinnedMediaVersionId: StoryProductionUuidSchema.nullable().optional(),
    required: z.boolean().default(true),
    rank: z.number().int().nonnegative().max(10_000).default(0),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === 'follow_selected' && value.pinnedMediaVersionId) {
      context.addIssue({
        code: 'custom',
        path: ['pinnedMediaVersionId'],
        message: 'A follow-selected binding cannot pin a media version.',
      });
    }
    if (value.mode === 'pinned' && !value.pinnedMediaVersionId) {
      context.addIssue({
        code: 'custom',
        path: ['pinnedMediaVersionId'],
        message: 'A pinned binding requires a creative media version.',
      });
    }
  });
export type PutStoryStoryboardBindingInput = z.infer<
  typeof PutStoryStoryboardBindingSchema
>;

export const PatchStoryStoryboardCueSchema = z
  .object({
    expectedVersion: StoryProductionVersionSchema,
    atMs: z.number().int().min(0).max(3_600_000),
  })
  .strict();
export type PatchStoryStoryboardCueInput = z.infer<
  typeof PatchStoryStoryboardCueSchema
>;
