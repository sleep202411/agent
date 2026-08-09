import { z } from 'zod';

const UuidSchema = z.string().uuid();
const SectionTitleSchema = z.string().trim().min(1).max(160);

export const ProjectSectionsParamsSchema = z.object({
  projectId: UuidSchema,
});
export type ProjectSectionsParams = z.infer<typeof ProjectSectionsParamsSchema>;

export const ProjectSectionParamsSchema = z.object({
  projectId: UuidSchema,
  sectionId: UuidSchema,
});
export type ProjectSectionParams = z.infer<typeof ProjectSectionParamsSchema>;

export const CreateProjectSectionSchema = z.object({
  title: SectionTitleSchema,
  expectedProjectVersion: z.number().int().min(0),
});
export type CreateProjectSectionInput = z.infer<
  typeof CreateProjectSectionSchema
>;

export const UpdateProjectSectionSchema = z.object({
  title: SectionTitleSchema,
  expectedVersion: z.number().int().min(0),
});
export type UpdateProjectSectionInput = z.infer<
  typeof UpdateProjectSectionSchema
>;

export const ReorderProjectSectionsSchema = z.object({
  sectionIds: z.array(UuidSchema).min(1).max(500),
  expectedProjectVersion: z.number().int().min(0),
});
export type ReorderProjectSectionsInput = z.infer<
  typeof ReorderProjectSectionsSchema
>;

export const ArchiveProjectSectionSchema = z.object({
  expectedProjectVersion: z.number().int().min(0),
  expectedSectionVersion: z.number().int().min(0),
});
export type ArchiveProjectSectionInput = z.infer<
  typeof ArchiveProjectSectionSchema
>;
