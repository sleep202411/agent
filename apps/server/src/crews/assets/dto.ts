import { z } from 'zod';

const NodeIdSchema = z.string().uuid();
const ParentIdSchema = NodeIdSchema.nullable().optional();
const NodeNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((name) => name !== '.' && name !== '..', {
    message: 'name cannot be "." or ".."',
  })
  .refine((name) => !name.includes('/'), {
    message: 'name cannot contain "/"',
  });

export const ListCrewAssetsSchema = z.object({
  parentId: NodeIdSchema.optional(),
  source: z.enum(['all', 'recent', 'favorites', 'trash']).default('all'),
  query: z.string().trim().max(256).optional(),
  kind: z.enum(['folder', 'file']).optional(),
  sort: z.enum(['modified', 'name', 'size']).default('modified'),
  cursor: NodeIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type ListCrewAssetsQuery = z.infer<typeof ListCrewAssetsSchema>;

export const CreateCrewAssetFolderSchema = z.object({
  parentId: ParentIdSchema,
  name: NodeNameSchema,
});
export type CreateCrewAssetFolderInput = z.infer<
  typeof CreateCrewAssetFolderSchema
>;

export const AttachCrewAssetFileSchema = z.object({
  parentId: ParentIdSchema,
  name: NodeNameSchema,
  mediaAssetId: z.string().uuid(),
});
export type AttachCrewAssetFileInput = z.infer<
  typeof AttachCrewAssetFileSchema
>;

export const UpdateCrewAssetNodeSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    parentId: ParentIdSchema,
    name: NodeNameSchema.optional(),
  })
  .refine((value) => value.parentId !== undefined || value.name !== undefined, {
    message: 'At least one of parentId or name is required',
  });
export type UpdateCrewAssetNodeInput = z.infer<
  typeof UpdateCrewAssetNodeSchema
>;

export const SetCrewAssetFavoriteSchema = z.object({
  favorite: z.boolean(),
});
export type SetCrewAssetFavoriteInput = z.infer<
  typeof SetCrewAssetFavoriteSchema
>;

export const SetCrewAssetPermissionsSchema = z
  .object({
    accessMode: z.enum(['inherit', 'restricted']),
    expectedVersion: z.number().int().positive(),
    grants: z
      .array(
        z
          .object({
            userId: z.string().trim().min(1).max(64),
            permission: z.enum(['view', 'upload', 'edit', 'manage']),
          })
          .strict(),
      )
      .max(500),
  })
  .strict()
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.grants.forEach((grant, index) => {
      if (seen.has(grant.userId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['grants', index, 'userId'],
          message: 'A member can only have one permission per asset',
        });
      }
      seen.add(grant.userId);
    });
    if (input.accessMode === 'inherit' && input.grants.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grants'],
        message: 'Inherited permissions cannot include explicit grants',
      });
    }
  });
export type SetCrewAssetPermissionsInput = z.infer<
  typeof SetCrewAssetPermissionsSchema
>;
