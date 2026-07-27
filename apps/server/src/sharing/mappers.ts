import type {
  ProjectInvite,
  ProjectMember,
  WorkspaceInvite,
  WorkspaceMember,
} from '@prisma/client';

/** Minimal display identity (from UsersService.lookupByUserIds). */
export interface MemberIdentity {
  nickname: string;
  avatar: string | null;
}

/** A member row + resolved identity as it crosses the wire. */
export interface SharingMemberDTO {
  memberId: string;
  userId: string;
  nickname: string | null;
  avatar: string | null;
  role: string;
  status: string;
  joinedAt: string | null;
  /** The immutable owner (creator) — cannot be removed or re-roled. */
  isOwner: boolean;
  /** True for the row representing the requesting user. */
  isSelf: boolean;
}

export function toWorkspaceMemberDTO(
  member: WorkspaceMember,
  identity: MemberIdentity | undefined,
  viewerId: string,
): SharingMemberDTO {
  return {
    memberId: member.id,
    userId: member.userId,
    nickname: identity?.nickname ?? null,
    avatar: identity?.avatar ?? null,
    role: member.role,
    status: member.status,
    joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
    isOwner: member.role === 'owner',
    isSelf: member.userId === viewerId,
  };
}

export function toProjectMemberDTO(
  member: ProjectMember,
  identity: MemberIdentity | undefined,
  viewerId: string,
): SharingMemberDTO {
  return {
    memberId: member.id,
    userId: member.userId,
    nickname: identity?.nickname ?? null,
    avatar: identity?.avatar ?? null,
    role: member.role,
    status: member.status,
    joinedAt: member.createdAt.toISOString(),
    isOwner: member.role === 'owner',
    isSelf: member.userId === viewerId,
  };
}

/** Sharing scope of an invite — drives the accept-page copy + deeplink. */
export type ShareScope = 'workspace' | 'project' | 'story-project';

/** A pending invite row as listed to an admin (never carries the raw token). */
export interface ShareInviteDTO {
  inviteId: string;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

export function toWorkspaceInviteDTO(invite: WorkspaceInvite): ShareInviteDTO {
  return {
    inviteId: invite.id,
    role: invite.role,
    status: invite.status,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
  };
}

export function toProjectInviteDTO(invite: ProjectInvite): ShareInviteDTO {
  return {
    inviteId: invite.id,
    role: invite.role,
    status: invite.status,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
  };
}

/**
 * What the accept page shows before a recipient commits: which team/project
 * they're joining, at what role, and whether the link is still usable. Status
 * is the *effective* status (lazy-expired), never the raw column alone.
 */
export interface InvitePreviewDTO {
  scope: ShareScope;
  targetName: string;
  role: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
}
