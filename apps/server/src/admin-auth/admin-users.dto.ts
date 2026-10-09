import { z } from 'zod';

export const AdminUserStatusSchema = z.enum([
  'invited',
  'active',
  'suspended',
  'disabled',
]);

export const AdminSiteScopeSchema = z.enum(['global', 'cn', 'all']);
export const AdminRoleKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,62}$/, '角色标识须为小写字母。');
export const AssignableAdminRoleKeySchema = AdminRoleKeySchema.refine(
  (key) => key !== 'super_admin',
  { message: '该角色不能通过后台页面分配。' },
);

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

export const ListAdminSessionsQuerySchema = z
  .object({
    status: z.enum(['active', 'all']).default('active'),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
export type ListAdminSessionsQuery = z.infer<
  typeof ListAdminSessionsQuerySchema
>;

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
    roleKey: AssignableAdminRoleKeySchema.default('operations'),
    requireMfa: z.boolean().default(true),
    status: AdminUserStatusSchema.default('active'),
  })
  .strict();
export type CreateAdminUserInput = z.infer<typeof CreateAdminUserSchema>;

/** Web/Java platform user id used on course instructor rows. */
export const PlatformUserIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{0,15}$/, '须为 Web 端用户数字 ID。');

export const UpdateAdminUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    siteScope: AdminSiteScopeSchema.optional(),
    roleKey: AssignableAdminRoleKeySchema.optional(),
    requireMfa: z.boolean().optional(),
    status: AdminUserStatusSchema.optional(),
    platformUserId: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? null : value,
      PlatformUserIdSchema.nullable().optional(),
    ),
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

export const AdminRoleParamsSchema = z
  .object({
    roleKey: AdminRoleKeySchema,
  })
  .strict();
export type AdminRoleParams = z.infer<typeof AdminRoleParamsSchema>;

export const CreateAdminRoleSchema = z
  .object({
    key: AdminRoleKeySchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    permissions: z.array(z.string().trim().min(1).max(120)).min(1).max(80),
  })
  .strict();
export type CreateAdminRoleInput = z.infer<typeof CreateAdminRoleSchema>;

export const UpdateAdminRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    permissions: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(80)
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要更新一个字段。',
  });
export type UpdateAdminRoleInput = z.infer<typeof UpdateAdminRoleSchema>;
