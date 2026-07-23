import { z } from 'zod';
import { canonicalJsonHash } from './canonical-json';

const StoryVideoModelSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const StoryVideoGenerationModeSchema = z.enum([
  'multimodal_to_video',
  'first_last_frame_to_video',
]);
export type StoryVideoGenerationMode = z.infer<
  typeof StoryVideoGenerationModeSchema
>;

export const StoryVideoReferenceRoleSchema = z.enum([
  'reference',
  'first_frame',
  'last_frame',
]);
export type StoryVideoReferenceRole = z.infer<
  typeof StoryVideoReferenceRoleSchema
>;

export const StoryVideoGenerationReferenceInputSchema = z
  .object({
    referenceVersionId: z.string().uuid(),
    role: StoryVideoReferenceRoleSchema,
  })
  .strict();
export type StoryVideoGenerationReferenceInput = z.infer<
  typeof StoryVideoGenerationReferenceInputSchema
>;

const StoryVideoRecipeInputFields = {
  prompt: z.string().trim().min(1).max(100_000),
  modelId: StoryVideoModelSlugSchema,
  mode: StoryVideoGenerationModeSchema,
  durationMs: z
    .number()
    .int()
    .min(1_000)
    .max(10 * 60 * 1_000),
  references: z
    .array(StoryVideoGenerationReferenceInputSchema)
    .max(12)
    .default([]),
  seed: z.string().trim().regex(/^\d+$/).max(40).optional(),
} as const;

function validateReferencePlan(
  input: {
    mode: StoryVideoGenerationMode;
    references: StoryVideoGenerationReferenceInput[];
  },
  context: z.RefinementCtx,
): void {
  const versionIds = new Set<string>();
  input.references.forEach((reference, index) => {
    if (versionIds.has(reference.referenceVersionId)) {
      context.addIssue({
        code: 'custom',
        path: ['references', index, 'referenceVersionId'],
        message: 'A reference version may appear only once in one recipe.',
      });
    }
    versionIds.add(reference.referenceVersionId);
  });

  if (input.mode === 'multimodal_to_video') {
    input.references.forEach((reference, index) => {
      if (reference.role !== 'reference') {
        context.addIssue({
          code: 'custom',
          path: ['references', index, 'role'],
          message: 'Multimodal generation accepts only reference roles.',
        });
      }
    });
    return;
  }

  if (input.references.length !== 2) {
    context.addIssue({
      code: 'custom',
      path: ['references'],
      message:
        'First/last-frame generation requires exactly one first frame and one last frame.',
    });
    return;
  }
  const roles = input.references.map((reference) => reference.role);
  for (const requiredRole of ['first_frame', 'last_frame'] as const) {
    if (roles.filter((role) => role === requiredRole).length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['references'],
        message:
          'First/last-frame generation requires exactly one first frame and one last frame.',
      });
      return;
    }
  }
}

export const CreateStoryTrailerVideoGenerationSchema = z
  .object({
    expectedSelectionVersion: z.number().int().nonnegative(),
    ...StoryVideoRecipeInputFields,
  })
  .strict()
  .superRefine(validateReferencePlan);
export type CreateStoryTrailerVideoGenerationInput = z.infer<
  typeof CreateStoryTrailerVideoGenerationSchema
>;

export const CancelStoryVideoGenerationSchema = z
  .object({ expectedGenerationVersion: z.number().int().nonnegative() })
  .strict();
export type CancelStoryVideoGenerationInput = z.infer<
  typeof CancelStoryVideoGenerationSchema
>;

export const RetryStoryVideoGenerationSchema = z
  .object({
    expectedGenerationVersion: z.number().int().nonnegative(),
    expectedSelectionVersion: z.number().int().nonnegative(),
  })
  .strict();
export type RetryStoryVideoGenerationInput = z.infer<
  typeof RetryStoryVideoGenerationSchema
>;

const StoryVideoSelectionMutationFields = {
  expectedSelectionVersion: z.number().int().nonnegative(),
  assetId: z.string().uuid().nullable(),
  variantId: z.string().uuid().nullable(),
} as const;

function validateSelectedAsset(
  input: { assetId: string | null; variantId: string | null },
  context: z.RefinementCtx,
): void {
  if ((input.assetId === null) !== (input.variantId === null)) {
    context.addIssue({
      code: 'custom',
      path: input.assetId === null ? ['assetId'] : ['variantId'],
      message: 'assetId and variantId must both be UUIDs or both be null.',
    });
  }
}

export const PutStoryClipVideoSelectionSchema = z
  .object({
    expectedDraftRevision: z.number().int().nonnegative(),
    ...StoryVideoSelectionMutationFields,
  })
  .strict()
  .superRefine(validateSelectedAsset);
export type PutStoryClipVideoSelectionInput = z.infer<
  typeof PutStoryClipVideoSelectionSchema
>;

export const PutStoryTrailerVideoSelectionSchema = z
  .object(StoryVideoSelectionMutationFields)
  .strict()
  .superRefine(validateSelectedAsset);
export type PutStoryTrailerVideoSelectionInput = z.infer<
  typeof PutStoryTrailerVideoSelectionSchema
>;

export const StoryVideoRecipeSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    prompt: z.string().min(1).max(100_000),
    mode: StoryVideoGenerationModeSchema,
    durationMs: z
      .number()
      .int()
      .min(1_000)
      .max(10 * 60 * 1_000),
    seed: z.string().regex(/^\d+$/).max(40).nullable(),
    model: z
      .object({
        id: z.string().uuid(),
        slug: StoryVideoModelSlugSchema,
        displayName: z.string().min(1).max(240),
        schemaVersion: z.string().min(1).max(120),
        generationModes: z.array(z.string().min(1).max(120)).max(50),
      })
      .strict(),
    references: z
      .array(
        z
          .object({
            referenceSlotId: z.string().uuid(),
            referenceVersionId: z.string().uuid(),
            role: StoryVideoReferenceRoleSchema,
            position: z.number().int().nonnegative(),
            assetId: z.string().uuid(),
            variantId: z.string().uuid(),
            checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export type StoryVideoRecipeSnapshot = z.infer<
  typeof StoryVideoRecipeSnapshotSchema
>;

const StoryVideoSnapshotNullableMediaFields = {
  assetId: z.string().uuid().nullable(),
  variantId: z.string().uuid().nullable(),
  checksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  contentType: z
    .string()
    .refine((value) => value.toLowerCase().startsWith('video/'), {
      message: 'contentType must be a video/* MIME type',
    })
    .nullable(),
  durationMs: z.number().int().positive().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  browserSafeMp4: z.boolean().nullable(),
} as const;

/**
 * The exact current-video identity consumed by preview and immutable Builds.
 * An empty selection has every media field set to null; a playable selection
 * has every media field populated. There is no partial or legacy shape.
 */
export const StoryVideoSnapshotEntrySchema = z
  .object({
    graphNodeId: z.string().trim().min(1).max(128),
    selectionVersion: z.number().int().nonnegative(),
    sourceGenerationAttemptId: z.string().uuid().nullable(),
    ...StoryVideoSnapshotNullableMediaFields,
  })
  .strict()
  .superRefine((entry, context) => {
    const values = Object.keys(StoryVideoSnapshotNullableMediaFields).map(
      (key) => entry[key as keyof typeof StoryVideoSnapshotNullableMediaFields],
    );
    const nullCount = values.filter((value) => value === null).length;
    if (nullCount !== 0 && nullCount !== values.length) {
      context.addIssue({
        code: 'custom',
        message:
          'A video snapshot entry must contain either one complete current video or no current video.',
      });
    }
    if (
      nullCount === values.length &&
      entry.sourceGenerationAttemptId !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceGenerationAttemptId'],
        message: 'An empty video selection cannot reference a generation.',
      });
    }
  });
export type StoryVideoSnapshotEntry = z.infer<
  typeof StoryVideoSnapshotEntrySchema
>;

export function storyVideoSnapshotHash(
  entries: readonly StoryVideoSnapshotEntry[],
): string {
  const canonicalEntries = entries
    .map((entry) => StoryVideoSnapshotEntrySchema.parse(entry))
    .sort((left, right) => left.graphNodeId.localeCompare(right.graphNodeId));
  const nodeIds = new Set(canonicalEntries.map((entry) => entry.graphNodeId));
  if (nodeIds.size !== canonicalEntries.length) {
    throw new Error('A video snapshot may contain each graph node only once.');
  }
  return canonicalJsonHash(canonicalEntries);
}
