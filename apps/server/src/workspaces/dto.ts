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

export const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: SlugSchema,
  description: z.string().trim().max(500).optional(),
  avatarUrl: z.string().trim().url().max(512).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

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
  initialSectionTitle: z.string().trim().min(1).max(160),
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
  /** Explicit cover asset. `null` clears it (thumbnail falls back to the
   *  derived canvas-first-image); `undefined` leaves it untouched. */
  coverAssetId: z.string().uuid().nullable().optional(),
  expectedVersion: z.number().int().min(0).optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

export const DeleteWorkspaceSchema = z.object({
  expectedVersion: z.number().int().min(0).optional(),
});
export type DeleteWorkspaceInput = z.infer<typeof DeleteWorkspaceSchema>;

export const ArchiveProjectSchema = z.object({
  expectedVersion: z.number().int().min(0).optional(),
});
export type ArchiveProjectInput = z.infer<typeof ArchiveProjectSchema>;
