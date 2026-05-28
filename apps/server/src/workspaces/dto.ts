import { z } from 'zod';

const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/)
  .optional();

export const WorkspaceParamsSchema = z.object({
  workspaceId: z.string().uuid(),
});
export type WorkspaceParams = z.infer<typeof WorkspaceParamsSchema>;

export const ProjectParamsSchema = z.object({
  projectId: z.string().uuid(),
});
export type ProjectParams = z.infer<typeof ProjectParamsSchema>;

export const CreateTeamWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: SlugSchema,
  description: z.string().trim().max(500).optional(),
  avatarUrl: z.string().trim().url().max(512).optional(),
});
export type CreateTeamWorkspaceInput = z.infer<
  typeof CreateTeamWorkspaceSchema
>;

export const UpdateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: SlugSchema,
  description: z.string().trim().max(500).nullable().optional(),
  avatarUrl: z.string().trim().url().max(512).nullable().optional(),
  expectedVersion: z.number().int().min(0).optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: SlugSchema,
  projectType: z.string().trim().min(1).max(64).default('general'),
  visibility: z.enum(['private', 'workspace', 'public']).default('private'),
  description: z.string().trim().max(5000).optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  slug: SlugSchema.nullable().optional(),
  projectType: z.string().trim().min(1).max(64).optional(),
  visibility: z.enum(['private', 'workspace', 'public']).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  expectedVersion: z.number().int().min(0).optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

export const LegacyProjectSourceSystemSchema = z.enum([
  'java_content',
  'java_studio',
]);

export const LegacyProjectEntityTypeSchema = z.enum(['project', 'episode']);

export const LegacyProjectMigrationStatusSchema = z.enum([
  'mapped',
  'importing',
  'migrated',
  'failed',
  'ignored',
]);

export const LegacyProjectMetadataSchema = z
  .object({})
  .catchall(z.unknown())
  .default({});

export const UpsertLegacyProjectMappingSchema = z.object({
  sourceSystem: LegacyProjectSourceSystemSchema.default('java_content'),
  entityType: LegacyProjectEntityTypeSchema,
  legacyEntityId: z.string().trim().min(1).max(64),
  legacyParentEntityId: z.string().trim().min(1).max(64).nullable().optional(),
  displayName: z.string().trim().min(1).max(160).nullable().optional(),
  coverUrl: z.string().trim().url().max(1024).nullable().optional(),
  metadata: LegacyProjectMetadataSchema.optional(),
});
export type UpsertLegacyProjectMappingInput = z.infer<
  typeof UpsertLegacyProjectMappingSchema
>;

export const ListLegacyProjectMappingsQuerySchema = z.object({
  sourceSystem: LegacyProjectSourceSystemSchema.optional(),
  entityType: LegacyProjectEntityTypeSchema.optional(),
  migrationStatus: LegacyProjectMigrationStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListLegacyProjectMappingsQuery = z.infer<
  typeof ListLegacyProjectMappingsQuerySchema
>;
