import { z } from 'zod';
import {
  StoryAssetSpecParamsSchema,
  StoryStoryboardClipParamsSchema,
} from './story-production-plan.schema';

const GenerationUuidSchema = z.uuid();
const GenerationVersionSchema = z.number().int().nonnegative();
const GenerationIdentifierSchema = z.string().trim().min(1).max(180);

const RESERVED_OPTION_KEYS = new Set([
  'prompt',
  'negativeprompt',
  'promptdocument',
  'referenceimages',
  'referencevideos',
  'referenceaudios',
  'startframe',
  'endframe',
  'firstframe',
  'lastframe',
  'maskimage',
  'inputimage',
  'inputvideo',
  'imagereference',
  'videoreference',
  'audioreference',
  'duration',
  'durationseconds',
]);

const GenerationOptionScalarSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string().trim().min(1).max(180),
]);

const GenerationOptionValueSchema = z.union([
  GenerationOptionScalarSchema,
  z.array(GenerationOptionScalarSchema).max(32),
]);

/**
 * Model knobs are deliberately scalar-only. Prompt text, reference media and
 * provider URLs are server-owned snapshots of the Story target, never an
 * alternate client-controlled input channel hidden inside an "options" bag.
 */
export const StoryGenerationOptionsSchema = z
  .record(z.string().trim().min(1).max(120), GenerationOptionValueSchema)
  .superRefine((options, context) => {
    for (const [key, value] of Object.entries(options)) {
      const canonicalKey = key.replaceAll(/[_-]/g, '').toLowerCase();
      if (
        RESERVED_OPTION_KEYS.has(canonicalKey) ||
        canonicalKey.includes('reference') ||
        canonicalKey.endsWith('frame') ||
        canonicalKey.includes('mask')
      ) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message:
            'Story generation prompts and media references are controlled by the target specification.',
        });
        continue;
      }
      const values = Array.isArray(value) ? value : [value];
      if (
        values.some((item) => typeof item === 'string' && isMediaLocator(item))
      ) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Story generation options cannot contain media URLs.',
        });
      }
    }
  });
export type StoryGenerationOptions = z.infer<
  typeof StoryGenerationOptionsSchema
>;

const StoryGenerationSubmissionFields = {
  expectedVersion: GenerationVersionSchema,
  /**
   * Omitting both fields asks the server to resolve the current accessible
   * default from the canonical AI catalog. Supplying one requires the other so
   * a stale UI can never silently submit against a different schema.
   */
  modelId: GenerationIdentifierSchema.optional(),
  schemaVersion: GenerationIdentifierSchema.optional(),
  options: StoryGenerationOptionsSchema.optional().default({}),
};

function requireCompleteModelSelection(
  value: { modelId?: string; schemaVersion?: string },
  context: z.RefinementCtx,
): void {
  if (Boolean(value.modelId) === Boolean(value.schemaVersion)) return;
  context.addIssue({
    code: 'custom',
    path: [value.modelId ? 'schemaVersion' : 'modelId'],
    message: 'modelId and schemaVersion must be supplied together.',
  });
}

export const CreateStoryAssetGenerationSchema = z
  .object({
    ...StoryGenerationSubmissionFields,
    outputKind: z.enum(['image', 'video']).default('image'),
  })
  .strict()
  .superRefine(requireCompleteModelSelection);
export type CreateStoryAssetGenerationInput = z.infer<
  typeof CreateStoryAssetGenerationSchema
>;

export const CreateStoryStoryboardClipGenerationSchema = z
  .object(StoryGenerationSubmissionFields)
  .strict()
  .superRefine(requireCompleteModelSelection);
export type CreateStoryStoryboardClipGenerationInput = z.infer<
  typeof CreateStoryStoryboardClipGenerationSchema
>;

export const RetryStoryProductionGenerationSchema = z
  .object({ expectedVersion: GenerationVersionSchema })
  .strict();
export type RetryStoryProductionGenerationInput = z.infer<
  typeof RetryStoryProductionGenerationSchema
>;

export const StoryAssetGenerationParamsSchema =
  StoryAssetSpecParamsSchema.extend({
    generationId: GenerationUuidSchema,
  }).strict();
export type StoryAssetGenerationParams = z.infer<
  typeof StoryAssetGenerationParamsSchema
>;

export const StoryStoryboardClipGenerationParamsSchema =
  StoryStoryboardClipParamsSchema.extend({
    generationId: GenerationUuidSchema,
  }).strict();
export type StoryStoryboardClipGenerationParams = z.infer<
  typeof StoryStoryboardClipGenerationParamsSchema
>;

function isMediaLocator(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /^(?:https?:|asset:|data:|blob:|file:)/.test(normalized);
}
