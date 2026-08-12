import { z } from 'zod';
import { PROJECT_SKILL_SCOPES } from '@repo/agent-skills';

export const ProjectSkillOwnerKindSchema = z.enum(['platform', 'story']);
export type ProjectSkillOwnerKind = z.infer<typeof ProjectSkillOwnerKindSchema>;

const idempotencyKey = z.string().trim().min(8).max(240);
const projectRevision = z.number().int().nonnegative();

export const ImportProjectSkillBodySchema = z
  .object({
    scope: z.enum(['project', 'workspace']),
    kind: z.enum(['general', 'image', 'video']),
    expectedProjectRevision: z.coerce.number().int().nonnegative(),
    idempotencyKey,
  })
  .strict();
export type ImportProjectSkillBody = z.infer<
  typeof ImportProjectSkillBodySchema
>;

export const InstallProjectSkillBodySchema = z
  .object({
    skillId: z.string().uuid(),
    versionId: z.string().uuid().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    defaultScopes: z.array(z.enum(PROJECT_SKILL_SCOPES)).max(6).optional(),
    expectedProjectRevision: projectRevision,
    idempotencyKey,
  })
  .strict();
export type InstallProjectSkillBody = z.infer<
  typeof InstallProjectSkillBodySchema
>;

export const UpdateProjectSkillBodySchema = z
  .object({
    versionId: z.string().uuid().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    expectedRevision: z.number().int().nonnegative(),
    expectedProjectRevision: projectRevision,
    idempotencyKey,
  })
  .strict()
  .refine(
    (value) =>
      value.versionId !== undefined ||
      value.config !== undefined ||
      value.status !== undefined,
    { message: 'At least one installation field must be updated.' },
  );
export type UpdateProjectSkillBody = z.infer<
  typeof UpdateProjectSkillBodySchema
>;

export const DeleteProjectSkillBodySchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    expectedProjectRevision: projectRevision,
    idempotencyKey,
  })
  .strict();
export type DeleteProjectSkillBody = z.infer<
  typeof DeleteProjectSkillBodySchema
>;

export const SetProjectSkillDefaultsBodySchema = z
  .object({
    installationIds: z.array(z.string().uuid()).max(32),
    workbenchMode: z.string().trim().min(1).max(64).optional(),
    sourceSurface: z.string().trim().min(1).max(64).optional(),
    expectedProjectRevision: projectRevision,
    idempotencyKey,
  })
  .strict();
export type SetProjectSkillDefaultsBody = z.infer<
  typeof SetProjectSkillDefaultsBodySchema
>;

export const ProjectSkillSelectionSchema = z
  .object({
    includeInstallationIds: z.array(z.string().uuid()).max(32).optional(),
    excludeInstallationIds: z.array(z.string().uuid()).max(32).optional(),
  })
  .strict()
  .optional();
export type ProjectSkillSelection = z.infer<typeof ProjectSkillSelectionSchema>;
