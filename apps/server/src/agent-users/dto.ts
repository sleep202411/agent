import { z } from 'zod';

export const AgentUserStatusSchema = z.enum(['active', 'paused', 'disabled']);
export const AgentUserIdentityStatusSchema = z.enum(['shadow', 'bound']);
export const AgentRunStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
export const AgentActionStatusSchema = z.enum([
  'planned',
  'running',
  'succeeded',
  'failed',
  'skipped',
]);
export const AgentMemoryTypeSchema = z.enum([
  'preference',
  'content_affinity',
  'negative_signal',
  'relationship',
  'summary',
  'fact',
]);
export const AgentMemoryStatusSchema = z.enum(['active', 'archived']);

const JsonObjectSchema = z.record(z.string(), z.unknown());

const NullableUrlSchema = z
  .string()
  .trim()
  .url()
  .max(512)
  .nullable()
  .optional();

const OptionalEmailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .toLowerCase()
  .nullable()
  .optional();

export const AgentUserParamsSchema = z.object({
  agentUserId: z.string().uuid(),
});
export type AgentUserParams = z.infer<typeof AgentUserParamsSchema>;

export const AgentRunParamsSchema = z.object({
  runId: z.string().uuid(),
});
export type AgentRunParams = z.infer<typeof AgentRunParamsSchema>;

export const AgentIpParamsSchema = z.object({
  agentUserId: z.string().uuid(),
  ipId: z.string().uuid(),
});
export type AgentIpParams = z.infer<typeof AgentIpParamsSchema>;

export const AgentMemoryParamsSchema = z.object({
  agentUserId: z.string().uuid(),
  memoryId: z.string().uuid(),
});
export type AgentMemoryParams = z.infer<typeof AgentMemoryParamsSchema>;

export const ListAdminAgentUsersQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: AgentUserStatusSchema.optional(),
  identityStatus: AgentUserIdentityStatusSchema.optional(),
  locale: z.string().trim().min(2).max(16).optional(),
  region: z.string().trim().toUpperCase().min(2).max(16).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListAdminAgentUsersQuery = z.infer<
  typeof ListAdminAgentUsersQuerySchema
>;

export const CreateAdminAgentUserSchema = z
  .object({
    handle: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
    displayName: z.string().trim().min(1).max(120),
    avatarUrl: NullableUrlSchema,
    status: AgentUserStatusSchema.default('active'),
    identityStatus: AgentUserIdentityStatusSchema.default('shadow'),
    platformUserId: z.string().trim().min(1).max(64).nullable().optional(),
    simulatedEmail: OptionalEmailSchema,
    locale: z.string().trim().min(2).max(16).default('zh-CN'),
    region: z
      .string()
      .trim()
      .toUpperCase()
      .min(2)
      .max(16)
      .nullable()
      .optional(),
    timezone: z.string().trim().min(1).max(64).default('Asia/Shanghai'),
    persona: JsonObjectSchema.default({}),
    schedule: JsonObjectSchema.default({}),
    policy: JsonObjectSchema.default({}),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();
export type CreateAdminAgentUserInput = z.infer<
  typeof CreateAdminAgentUserSchema
>;

export const UpdateAdminAgentUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    avatarUrl: NullableUrlSchema,
    status: AgentUserStatusSchema.optional(),
    identityStatus: AgentUserIdentityStatusSchema.optional(),
    platformUserId: z.string().trim().min(1).max(64).nullable().optional(),
    simulatedEmail: OptionalEmailSchema,
    locale: z.string().trim().min(2).max(16).optional(),
    region: z
      .string()
      .trim()
      .toUpperCase()
      .min(2)
      .max(16)
      .nullable()
      .optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    persona: JsonObjectSchema.optional(),
    schedule: JsonObjectSchema.optional(),
    policy: JsonObjectSchema.optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required.',
  });
export type UpdateAdminAgentUserInput = z.infer<
  typeof UpdateAdminAgentUserSchema
>;

export const ListAgentRunsQuerySchema = z.object({
  status: AgentRunStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListAgentRunsQuery = z.infer<typeof ListAgentRunsQuerySchema>;

export const ListAgentActionsQuerySchema = z.object({
  runId: z.string().uuid().optional(),
  status: AgentActionStatusSchema.optional(),
  actionType: z.string().trim().min(1).max(80).optional(),
  targetType: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListAgentActionsQuery = z.infer<typeof ListAgentActionsQuerySchema>;

export const ListAgentMemoriesQuerySchema = z.object({
  type: AgentMemoryTypeSchema.optional(),
  status: AgentMemoryStatusSchema.optional(),
  scopeType: z.string().trim().min(1).max(64).optional(),
  scopeId: z.string().trim().min(1).max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListAgentMemoriesQuery = z.infer<
  typeof ListAgentMemoriesQuerySchema
>;

export const ListInternalAgentUsersQuerySchema = z.object({
  locale: z.string().trim().min(2).max(16).optional(),
  region: z.string().trim().toUpperCase().min(2).max(16).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListInternalAgentUsersQuery = z.infer<
  typeof ListInternalAgentUsersQuerySchema
>;

export const CreateAgentRunSchema = z
  .object({
    trigger: z.string().trim().min(1).max(64).default('scheduler'),
    status: z.enum(['queued', 'running']).default('queued'),
    objective: z.string().trim().max(500).nullable().optional(),
    metadata: JsonObjectSchema.default({}),
  })
  .strict();
export type CreateAgentRunInput = z.infer<typeof CreateAgentRunSchema>;

export const CompleteAgentRunSchema = z
  .object({
    status: z.enum(['succeeded', 'failed', 'cancelled']),
    summary: z.string().trim().max(8000).nullable().optional(),
    errorCode: z.string().trim().max(80).nullable().optional(),
    errorMessage: z.string().trim().max(8000).nullable().optional(),
    metrics: JsonObjectSchema.default({}),
    metadata: JsonObjectSchema.default({}),
  })
  .strict();
export type CompleteAgentRunInput = z.infer<typeof CompleteAgentRunSchema>;

export const CreateAgentActionSchema = z
  .object({
    runId: z.string().uuid().nullable().optional(),
    actionType: z.string().trim().min(1).max(80),
    targetType: z.string().trim().min(1).max(80).nullable().optional(),
    targetId: z.string().trim().min(1).max(128).nullable().optional(),
    status: AgentActionStatusSchema.default('planned'),
    idempotencyKey: z.string().trim().min(1).max(180).nullable().optional(),
    decision: JsonObjectSchema.default({}),
    input: JsonObjectSchema.default({}),
    result: JsonObjectSchema.default({}),
    metadata: JsonObjectSchema.default({}),
    errorCode: z.string().trim().max(80).nullable().optional(),
    errorMessage: z.string().trim().max(8000).nullable().optional(),
  })
  .strict();
export type CreateAgentActionInput = z.infer<typeof CreateAgentActionSchema>;

export const UpsertAgentMemorySchema = z
  .object({
    memoryKey: z.string().trim().min(1).max(180).nullable().optional(),
    type: AgentMemoryTypeSchema,
    status: AgentMemoryStatusSchema.default('active'),
    scopeType: z.string().trim().min(1).max(64).nullable().optional(),
    scopeId: z.string().trim().min(1).max(128).nullable().optional(),
    summary: z.string().trim().min(1).max(500),
    content: JsonObjectSchema.default({}),
    confidence: z.number().int().min(0).max(100).default(50),
    weight: z.number().int().min(0).max(10000).default(100),
    sourceActionIds: z.array(z.string().uuid()).max(50).default([]),
  })
  .strict();
export type UpsertAgentMemoryInput = z.infer<typeof UpsertAgentMemorySchema>;

export const UpdateAgentMemorySchema = z
  .object({
    status: AgentMemoryStatusSchema.optional(),
    summary: z.string().trim().min(1).max(500).optional(),
    content: JsonObjectSchema.optional(),
    confidence: z.number().int().min(0).max(100).optional(),
    weight: z.number().int().min(0).max(10000).optional(),
    sourceActionIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required.',
  });
export type UpdateAgentMemoryInput = z.infer<typeof UpdateAgentMemorySchema>;
