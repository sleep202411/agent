import { z } from 'zod';

export const AiControlPlaneStatusSchema = z.enum([
  'draft',
  'active',
  'disabled',
  'degraded',
  'archived',
]);
const WritableControlPlaneStatusSchema = z.enum([
  'draft',
  'active',
  'disabled',
  'degraded',
]);

export const AiJobTypeSchema = z.enum(['image', 'video']);

const JsonObjectSchema = z.record(z.string(), z.unknown());
const ProviderHealthStatusSchema = z.enum([
  'unknown',
  'healthy',
  'degraded',
  'outage',
]);
const MediaAssetSourceSchema = z.enum([
  'user_upload',
  'ai_output',
  'imported',
  'system',
]);
export const MediaAssetModerationStatusSchema = z.enum([
  'unreviewed',
  'approved',
  'flagged',
  'blocked',
]);
const ProviderCapacitySchema = {
  maxConcurrentRequests: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .nullable()
    .optional(),
  maxRequestsPerMinute: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .nullable()
    .optional(),
  requestTimeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(86_400)
    .nullable()
    .optional(),
  cooldownSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
  failureThreshold: z.number().int().min(1).max(100).nullable().optional(),
} as const;

export const ListAdminAiProvidersQuerySchema = z.object({
  provider: z.string().trim().min(1).optional(),
  status: AiControlPlaneStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListAdminAiProvidersQuery = z.infer<
  typeof ListAdminAiProvidersQuerySchema
>;

export const UpdateAdminAiProviderSchema = z.object({
  status: AiControlPlaneStatusSchema.optional(),
  rateLimitPolicy: JsonObjectSchema.optional(),
  quotaPolicy: JsonObjectSchema.optional(),
});
export type UpdateAdminAiProviderInput = z.infer<
  typeof UpdateAdminAiProviderSchema
>;

export const AdminAiProviderParamsSchema = z.object({
  providerAccountId: z.string().uuid(),
});
export type AdminAiProviderParams = z.infer<typeof AdminAiProviderParamsSchema>;

export const ListAdminAiModelsQuerySchema = z.object({
  modality: AiJobTypeSchema.optional(),
  family: z.string().trim().min(1).optional(),
  status: AiControlPlaneStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListAdminAiModelsQuery = z.infer<
  typeof ListAdminAiModelsQuerySchema
>;

export const CreateCanonicalModelSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  displayName: z.string().trim().min(1).max(160),
  modality: AiJobTypeSchema.default('image'),
  family: z.string().trim().min(1).max(80),
  generationModes: z.array(z.string().trim().min(1)).default([]),
  status: AiControlPlaneStatusSchema.default('draft'),
  description: z.string().trim().max(4000).nullable().optional(),
  parameterPolicy: JsonObjectSchema.default({}),
  outputPolicy: JsonObjectSchema.default({}),
  entitlementPolicy: JsonObjectSchema.default({}),
  billingPolicy: JsonObjectSchema.default({}),
  queuePolicy: JsonObjectSchema.default({}),
  uiPolicy: JsonObjectSchema.default({}),
  observabilityPolicy: JsonObjectSchema.default({}),
  metadata: JsonObjectSchema.default({}),
});
export type CreateCanonicalModelInput = z.infer<
  typeof CreateCanonicalModelSchema
>;

export const AdminAiModelParamsSchema = z.object({
  modelId: z.string().uuid(),
});
export type AdminAiModelParams = z.infer<typeof AdminAiModelParamsSchema>;

export const UpdateCanonicalModelSchema = z.object({
  displayName: z.string().trim().min(1).max(160).optional(),
  family: z.string().trim().min(1).max(80).optional(),
  status: AiControlPlaneStatusSchema.optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  generationModes: z.array(z.string().trim().min(1)).optional(),
  parameterPolicy: JsonObjectSchema.optional(),
  outputPolicy: JsonObjectSchema.optional(),
  entitlementPolicy: JsonObjectSchema.optional(),
  billingPolicy: JsonObjectSchema.optional(),
  queuePolicy: JsonObjectSchema.optional(),
  uiPolicy: JsonObjectSchema.optional(),
  observabilityPolicy: JsonObjectSchema.optional(),
  metadata: JsonObjectSchema.optional(),
});
export type UpdateCanonicalModelInput = z.infer<
  typeof UpdateCanonicalModelSchema
>;

export const ListAdminAiProviderBindingsQuerySchema = z.object({
  provider: z.string().trim().min(1).optional(),
  endpointId: z.string().trim().min(1).optional(),
  canonicalModelId: z.string().uuid().optional(),
  modality: AiJobTypeSchema.optional(),
  status: AiControlPlaneStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80),
});
export type ListAdminAiProviderBindingsQuery = z.infer<
  typeof ListAdminAiProviderBindingsQuerySchema
>;

export const ListAdminAiProviderEndpointsQuerySchema = z.object({
  providerAccountId: z.string().uuid().optional(),
  provider: z.string().trim().min(1).optional(),
  endpointId: z.string().trim().min(1).optional(),
  modality: AiJobTypeSchema.optional(),
  status: AiControlPlaneStatusSchema.optional(),
  healthStatus: z.enum(['unknown', 'healthy', 'degraded', 'outage']).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(120),
});
export type ListAdminAiProviderEndpointsQuery = z.infer<
  typeof ListAdminAiProviderEndpointsQuerySchema
>;

export const AdminAiProviderBindingParamsSchema = z.object({
  bindingId: z.string().uuid(),
});
export type AdminAiProviderBindingParams = z.infer<
  typeof AdminAiProviderBindingParamsSchema
>;

export const AdminAiProviderEndpointParamsSchema = z.object({
  endpointId: z.string().uuid(),
});
export type AdminAiProviderEndpointParams = z.infer<
  typeof AdminAiProviderEndpointParamsSchema
>;

export const CreateProviderEndpointSchema = z.object({
  providerAccountId: z.string().uuid(),
  endpointId: z.string().trim().min(1).max(180),
  displayName: z.string().trim().min(1).max(160).nullable().optional(),
  modality: AiJobTypeSchema.default('image'),
  status: WritableControlPlaneStatusSchema.default('draft'),
  healthStatus: ProviderHealthStatusSchema.default('unknown'),
  supportedModes: z.array(z.string().trim().min(1)).default([]),
  providerInputSchema: JsonObjectSchema.default({}),
  providerOutputSchema: JsonObjectSchema.default({}),
  ...ProviderCapacitySchema,
  catalogSnapshot: JsonObjectSchema.default({}),
  disabledReason: z.string().trim().max(4000).nullable().optional(),
});
export type CreateProviderEndpointInput = z.infer<
  typeof CreateProviderEndpointSchema
>;

export const UpdateProviderEndpointSchema = z.object({
  displayName: z.string().trim().min(1).max(160).nullable().optional(),
  status: WritableControlPlaneStatusSchema.optional(),
  healthStatus: ProviderHealthStatusSchema.optional(),
  supportedModes: z.array(z.string().trim().min(1)).optional(),
  providerInputSchema: JsonObjectSchema.optional(),
  providerOutputSchema: JsonObjectSchema.optional(),
  ...ProviderCapacitySchema,
  catalogSnapshot: JsonObjectSchema.optional(),
  disabledReason: z.string().trim().max(4000).nullable().optional(),
});
export type UpdateProviderEndpointInput = z.infer<
  typeof UpdateProviderEndpointSchema
>;

export const CreateProviderBindingSchema = z.object({
  canonicalModelId: z.string().uuid(),
  providerEndpointId: z.string().uuid(),
  status: WritableControlPlaneStatusSchema.default('draft'),
  priority: z.coerce.number().int().min(0).max(10_000).default(100),
  weight: z.coerce.number().int().min(0).max(10_000).default(100),
  disabledReason: z.string().trim().max(4000).nullable().optional(),
});
export type CreateProviderBindingInput = z.infer<
  typeof CreateProviderBindingSchema
>;

export const UpdateProviderBindingSchema = z.object({
  status: AiControlPlaneStatusSchema.optional(),
  priority: z.coerce.number().int().min(0).max(10_000).optional(),
  weight: z.coerce.number().int().min(0).max(10_000).optional(),
  disabledReason: z.string().trim().max(4000).nullable().optional(),
});
export type UpdateProviderBindingInput = z.infer<
  typeof UpdateProviderBindingSchema
>;

export const ListAdminAiJobsQuerySchema = z.object({
  provider: z.string().trim().min(1).optional(),
  modelId: z.string().trim().min(1).optional(),
  providerJobId: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).optional(),
  status: z
    .enum([
      'created',
      'in_queue',
      'in_progress',
      'completed',
      'failed',
      'cancelled',
      'expired',
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListAdminAiJobsQuery = z.infer<typeof ListAdminAiJobsQuerySchema>;

export const AdminAiJobParamsSchema = z.object({
  jobId: z.string().min(1),
});
export type AdminAiJobParams = z.infer<typeof AdminAiJobParamsSchema>;

export const ListAdminAiAssetsQuerySchema = z.object({
  source: MediaAssetSourceSchema.optional(),
  moderationStatus: MediaAssetModerationStatusSchema.optional(),
  workspaceId: z.string().uuid().optional(),
  userId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80),
});
export type ListAdminAiAssetsQuery = z.infer<
  typeof ListAdminAiAssetsQuerySchema
>;

export const AdminAiMediaAssetParamsSchema = z.object({
  assetId: z.string().uuid(),
});
export type AdminAiMediaAssetParams = z.infer<
  typeof AdminAiMediaAssetParamsSchema
>;

export const UpdateAdminAiMediaAssetModerationSchema = z.object({
  moderationStatus: MediaAssetModerationStatusSchema,
  reason: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateAdminAiMediaAssetModerationInput = z.infer<
  typeof UpdateAdminAiMediaAssetModerationSchema
>;
