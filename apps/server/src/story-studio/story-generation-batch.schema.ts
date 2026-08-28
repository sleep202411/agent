import { z } from 'zod';
import { StoryGenerationOptionsSchema } from './story-production-generation.schema';

const Identifier = z.string().trim().min(1).max(180);
const Target = z
  .object({
    id: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

const StoryboardClipTarget = Target.extend({
  sequenceId: z.uuid(),
}).strict();

export const QuoteStoryAssetGenerationBatchSchema = z
  .object({
    targets: z.array(Target).min(1).max(500),
    modelId: Identifier.optional(),
    schemaVersion: Identifier.optional(),
    outputKind: z.enum(['image', 'video']).default('image'),
    options: StoryGenerationOptionsSchema.optional().default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.modelId) === Boolean(value.schemaVersion)) return;
    context.addIssue({
      code: 'custom',
      path: [value.modelId ? 'schemaVersion' : 'modelId'],
      message: 'modelId and schemaVersion must be supplied together.',
    });
  });
export type QuoteStoryAssetGenerationBatchInput = z.infer<
  typeof QuoteStoryAssetGenerationBatchSchema
>;

export const QuoteStoryStoryboardGenerationBatchSchema = z
  .object({
    targets: z.array(StoryboardClipTarget).min(1).max(500),
  })
  .strict();
export type QuoteStoryStoryboardGenerationBatchInput = z.infer<
  typeof QuoteStoryStoryboardGenerationBatchSchema
>;

export const ConfirmStoryGenerationBatchSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();
export type ConfirmStoryGenerationBatchInput = z.infer<
  typeof ConfirmStoryGenerationBatchSchema
>;

export const StoryGenerationBatchParamsSchema = z
  .object({ projectId: z.uuid(), chapterId: z.uuid(), batchId: z.uuid() })
  .strict();
export type StoryGenerationBatchParams = z.infer<
  typeof StoryGenerationBatchParamsSchema
>;
