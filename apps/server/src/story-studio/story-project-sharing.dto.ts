import { StoryProjectMemberRole } from '@prisma/client';
import { z } from 'zod';

/**
 * Story-project sharing request schemas. Deliberately a separate namespace from
 * `sharing/dto.ts`: that one assigns platform roles (admin/editor/viewer) to
 * `platform_projects`, while a Story project carries its own five-rung ladder
 * with story capabilities attached to each rung.
 *
 * `owner` is never assignable — it is the creator's row, pinned to exactly one
 * per project by `story_project_members_one_active_owner_unique`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s-]{5,19}$/;

export const StoryAccountSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .refine((v) => EMAIL_RE.test(v) || PHONE_RE.test(v), {
    message: 'Enter a valid email or phone number',
  });

export const AssignableStoryRoleSchema = z.enum([
  'producer',
  'editor',
  'reviewer',
  'viewer',
]);
export type AssignableStoryRole = z.infer<typeof AssignableStoryRoleSchema>;

export const STORY_ROLE_MAP: Record<
  AssignableStoryRole,
  StoryProjectMemberRole
> = {
  producer: StoryProjectMemberRole.producer,
  editor: StoryProjectMemberRole.editor,
  reviewer: StoryProjectMemberRole.reviewer,
  viewer: StoryProjectMemberRole.viewer,
};

export const AddStoryMemberSchema = z.object({
  account: StoryAccountSchema,
  /** Read-only by default: sharing a story is usually "come look at this". */
  role: AssignableStoryRoleSchema.default('viewer'),
});
export type AddStoryMemberInput = z.infer<typeof AddStoryMemberSchema>;

export const UpdateStoryMemberRoleSchema = z.object({
  role: AssignableStoryRoleSchema,
});
export type UpdateStoryMemberRoleInput = z.infer<
  typeof UpdateStoryMemberRoleSchema
>;

export const CreateStoryInviteSchema = z.object({
  role: AssignableStoryRoleSchema.default('viewer'),
  /** Link validity window. Default 7 days, max 30. */
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
export type CreateStoryInviteInput = z.infer<typeof CreateStoryInviteSchema>;

/** A story member row + resolved identity as it crosses the wire. */
export interface StoryProjectMemberDto {
  memberId: string;
  userId: string;
  nickname: string | null;
  avatar: string | null;
  role: StoryProjectMemberRole;
  status: string;
  joinedAt: string;
  /** The immutable creator row — cannot be removed or re-roled. */
  isOwner: boolean;
  /** True for the row representing the requesting user. */
  isSelf: boolean;
}

export interface StoryProjectInviteDto {
  inviteId: string;
  role: StoryProjectMemberRole;
  status: string;
  createdAt: string;
  expiresAt: string;
}
