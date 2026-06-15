import { z } from 'zod';

/**
 * Sharing (team collaboration) request schemas. Scope-agnostic where the
 * shape is identical for workspace + project membership.
 *
 * Roles assignable via the sharing UI: admin / editor / viewer. `owner` is
 * the creator (never assigned by invite); workspace `billing` is a finance
 * role, out of scope for collaboration sharing.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s-]{5,19}$/;

export const AccountSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .refine((v) => EMAIL_RE.test(v) || PHONE_RE.test(v), {
    message: 'Enter a valid email or phone number',
  });

export const AssignableRoleSchema = z.enum(['admin', 'editor', 'viewer']);
export type AssignableRole = z.infer<typeof AssignableRoleSchema>;

export const AddMemberSchema = z.object({
  account: AccountSchema,
  role: AssignableRoleSchema.default('editor'),
});
export type AddMemberInput = z.infer<typeof AddMemberSchema>;

export const UpdateMemberRoleSchema = z.object({
  role: AssignableRoleSchema,
});
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleSchema>;

export const CreateInviteSchema = z.object({
  role: AssignableRoleSchema.default('editor'),
  /** Link validity window; clamped server-side. Default 7 days, max 30. */
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
export type CreateInviteInput = z.infer<typeof CreateInviteSchema>;

export const AcceptInviteSchema = z.object({
  token: z.string().trim().min(8).max(256),
});
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>;
