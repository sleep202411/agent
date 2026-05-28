import { z } from 'zod';

export const AdminUserStatusSchema = z.enum([
  'invited',
  'active',
  'suspended',
  'disabled',
]);

export const AdminSiteScopeSchema = z.enum(['global', 'cn', 'all']);
export const AdminRoleKeySchema = z.enum([
  'super_admin',
  'admin',
  'operations',
]);

export const ListAdminUsersQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: AdminUserStatusSchema.optional(),
    siteScope: AdminSiteScopeSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type ListAdminUsersQuery = z.infer<typeof ListAdminUsersQuerySchema>;

export const AdminUserParamsSchema = z
  .object({
    userId: z.string().uuid(),
  })
  .strict();
export type AdminUserParams = z.infer<typeof AdminUserParamsSchema>;

export const AdminUserSessionParamsSchema = z
  .object({
    userId: z.string().uuid(),
    sessionId: z.string().uuid(),
  })
  .strict();
export type AdminUserSessionParams = z.infer<
  typeof AdminUserSessionParamsSchema
>;

export const CreateAdminUserSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(320)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(8).max(200),
    displayName: z.string().trim().min(1).max(120),
    siteScope: AdminSiteScopeSchema.default('all'),
    roleKey: AdminRoleKeySchema.default('operations'),
    requireMfa: z.boolean().default(true),
    status: AdminUserStatusSchema.default('active'),
  })
  .strict();
export type CreateAdminUserInput = z.infer<typeof CreateAdminUserSchema>;

export const UpdateAdminUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    siteScope: AdminSiteScopeSchema.optional(),
    roleKey: AdminRoleKeySchema.optional(),
    requireMfa: z.boolean().optional(),
    status: AdminUserStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要更新一个字段。',
  });
export type UpdateAdminUserInput = z.infer<typeof UpdateAdminUserSchema>;

export const ResetAdminPasswordSchema = z
  .object({
    password: z.string().min(8).max(200),
  })
  .strict();
export type ResetAdminPasswordInput = z.infer<typeof ResetAdminPasswordSchema>;
