import { z } from 'zod';

export const AppPlatformSchema = z.enum(['ios', 'android']);

// Postgres INT4 max — versionCode/minSupportedCode map to `Int` columns, so a
// value above this passes Zod but 500s at Prisma. Bound it at the edge.
const INT4_MAX = 2_147_483_647;

export const CreateAppReleaseSchema = z
  .object({
    platform: AppPlatformSchema,
    versionName: z.string().trim().min(1).max(32),
    versionCode: z.number().int().min(1).max(INT4_MAX),
    downloadUrl: z.string().trim().url().max(1024),
    releaseNotes: z.string().trim().max(2000).optional().nullable(),
    minSupportedCode: z
      .number()
      .int()
      .min(1)
      .max(INT4_MAX)
      .optional()
      .nullable(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) => v.minSupportedCode == null || v.minSupportedCode <= v.versionCode,
    {
      // A floor above the release being announced would force-update everyone,
      // including this very build's own users — a self-contradiction.
      message: 'minSupportedCode 不能大于 versionCode',
      path: ['minSupportedCode'],
    },
  );

export const UpdateAppReleaseSchema = z
  .object({
    versionName: z.string().trim().min(1).max(32),
    versionCode: z.number().int().min(1).max(INT4_MAX),
    downloadUrl: z.string().trim().url().max(1024),
    releaseNotes: z.string().trim().max(2000).nullable(),
    minSupportedCode: z.number().int().min(1).max(INT4_MAX).nullable(),
    active: z.boolean(),
  })
  .partial()
  .refine(
    (v) =>
      v.minSupportedCode == null ||
      v.versionCode === undefined ||
      v.minSupportedCode <= v.versionCode,
    {
      message: 'minSupportedCode 不能大于 versionCode',
      path: ['minSupportedCode'],
    },
  );

export const ListAppReleasesQuerySchema = z.object({
  platform: AppPlatformSchema.optional(),
});

export type CreateAppReleaseInput = z.infer<typeof CreateAppReleaseSchema>;
export type UpdateAppReleaseInput = z.infer<typeof UpdateAppReleaseSchema>;
export type ListAppReleasesQuery = z.infer<typeof ListAppReleasesQuerySchema>;
