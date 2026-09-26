import { z } from 'zod';

export const AspectRatioEnum = z.enum(['1:1', '4:5', '9:16', '16:9']);
export type AspectRatio = z.infer<typeof AspectRatioEnum>;

export const AudienceGenerationTemplateAdminSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(''),
    modelId: z.string().trim().min(1).max(120),
    promptPrefix: z.string().trim().max(2000).default(''),
    promptSuffix: z.string().trim().max(2000).default(''),
    requireReferenceImage: z.boolean().default(true),
    referenceImageHint: z.string().trim().max(200).default(''),
    outputAspectRatio: AspectRatioEnum.default('1:1'),
    logoAssetId: z.string().uuid().nullable().default(null),
    enabled: z.boolean().default(true),
    order: z.number().int().default(0),
  })
  .strict();

export type AudienceGenerationTemplateAdmin = z.infer<
  typeof AudienceGenerationTemplateAdminSchema
>;

export const UpdateAudienceGenerationTemplatesSchema = z
  .object({
    templates: z.array(AudienceGenerationTemplateAdminSchema).max(50),
    expectedVersion: z.number().int().min(0),
  })
  .strict();

export type UpdateAudienceGenerationTemplatesDto = z.infer<
  typeof UpdateAudienceGenerationTemplatesSchema
>;

export const AudienceGenerationTemplatePublicSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string(),
    requireReferenceImage: z.boolean(),
    referenceImageHint: z.string(),
    outputAspectRatio: AspectRatioEnum,
    order: z.number(),
  })
  .strict();

export type AudienceGenerationTemplatePublic = z.infer<
  typeof AudienceGenerationTemplatePublicSchema
>;

export function toPublicAudienceTemplate(
  adminTemplate: AudienceGenerationTemplateAdmin,
): AudienceGenerationTemplatePublic {
  return {
    id: adminTemplate.id,
    name: adminTemplate.name,
    description: adminTemplate.description,
    requireReferenceImage: adminTemplate.requireReferenceImage,
    referenceImageHint: adminTemplate.referenceImageHint,
    outputAspectRatio: adminTemplate.outputAspectRatio,
    order: adminTemplate.order,
  };
}
