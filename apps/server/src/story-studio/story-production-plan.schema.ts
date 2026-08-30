import { z } from 'zod';

export { PutStoryStoryboardTimelineSchema } from '@repo/shared';
export type { PutStoryStoryboardTimelineInput } from '@repo/shared';

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
    /** Import a project-candidate image as a new creative version and select it. */
    sourceMediaAssetId: StoryProductionUuidSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      !(value.sourceMediaAssetId && value.selectedMediaVersionId !== undefined),
    {
      message:
        'Importing source media and selecting an existing media version are mutually exclusive.',
      path: ['sourceMediaAssetId'],
    },
  )
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
    // Scene title is canonical in StoryDraft and is edited on either the Plot
    // Tree or Storyboard node card, never on the timeline child record.
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

export const PatchStoryStoryboardClipSchema = z
  .object({
    expectedVersion: StoryProductionVersionSchema,
    kind: z.enum(['image', 'video']).optional(),
    title: StoryProductionTextSchema(160).optional(),
    description: z.string().trim().max(4_000).nullable().optional(),
    imagePrompt: StoryProductionTextSchema(12_000).nullable().optional(),
    videoPrompt: StoryProductionTextSchema(12_000).nullable().optional(),
    negativePrompt: StoryProductionTextSchema(4_000).nullable().optional(),
    selectedMediaVersionId: StoryProductionUuidSchema.nullable().optional(),
    /** Import project-candidate media as a new creative version and select it. */
    sourceMediaAssetId: StoryProductionUuidSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      !(value.sourceMediaAssetId && value.selectedMediaVersionId !== undefined),
    {
      message:
        'Importing source media and selecting an existing media version are mutually exclusive.',
      path: ['sourceMediaAssetId'],
    },
  )
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
