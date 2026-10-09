import { z } from 'zod';

export const AdminLoginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(320)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(8).max(200),
  })
  .strict();
export type AdminLoginInput = z.infer<typeof AdminLoginSchema>;

export const AdminMfaVerifySchema = z
  .object({
    challengeToken: z.string().min(20).max(120),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/),
  })
  .strict();
export type AdminMfaVerifyInput = z.infer<typeof AdminMfaVerifySchema>;

export const AdminProfileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    avatarUrl: z
      .preprocess(
        (value) =>
          typeof value === 'string' && value.trim() === '' ? null : value,
        z.string().trim().url().max(512).nullable().optional(),
      )
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要更新一个字段。',
  });
export type AdminProfileUpdateInput = z.infer<typeof AdminProfileUpdateSchema>;

export const AdminPasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(8).max(200),
    newPassword: z.string().min(8).max(200),
  })
  .strict();
export type AdminPasswordChangeInput = z.infer<
  typeof AdminPasswordChangeSchema
>;

export const AdminSessionResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string(),
    avatarUrl: z.string().url().nullable().optional(),
    status: z.string(),
    siteScope: z.enum(['global', 'cn', 'all']),
    platformUserId: z.string().nullable().optional(),
    roleKeys: z.array(z.string()).optional(),
    requireMfa: z.boolean().optional(),
    mfaEnabledAt: z.string().nullable().optional(),
    permissions: z.array(z.string()),
  }),
  session: z.object({
    id: z.string().uuid(),
    expiresAt: z.string(),
  }),
});
