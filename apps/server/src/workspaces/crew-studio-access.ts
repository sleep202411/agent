import { WorkspaceMemberRole, type Prisma } from '@prisma/client';
import { crewAuthorizationFromMember } from '../crews/crew-authorization.service';

export const CREW_STUDIO_MEMBER_SELECT = {
  id: true,
  ownership: { select: { crewId: true } },
  policies: { select: { policyKey: true } },
  permissionOverrides: { select: { permissionKey: true, effect: true } },
} as const satisfies Prisma.CrewMemberSelect;

type AccessMember = Prisma.CrewMemberGetPayload<{
  select: typeof CREW_STUDIO_MEMBER_SELECT;
}>;
export function crewStudioRoleForMember(
  crewId: string,
  userId: string,
  member: AccessMember,
): 'viewer' | 'editor' | undefined {
  const { permissions } = crewAuthorizationFromMember(crewId, userId, member);
  if (!permissions.includes('studio.view')) return undefined;
  return permissions.includes('studio.edit')
    ? WorkspaceMemberRole.editor
    : WorkspaceMemberRole.viewer;
}

export type CrewStudioAccessDb = Pick<Prisma.TransactionClient, 'crew'>;
export type CrewStudioAccess = {
  crewId: string;
  workspaceId: string;
  userId: string;
  role: 'viewer' | 'editor';
  accessScope: 'workspace';
};

/**
 * A live, additive grant. No WorkspaceMember is overwritten or manufactured:
 * unlinking, removing membership or changing studio.edit changes the next read.
 * Community subscriptions and crew administration alone grant no Studio admin role.
 */
export async function resolveCrewStudioAccess(
  db: CrewStudioAccessDb,
  workspaceId: string,
  userId: string,
): Promise<CrewStudioAccess | null> {
  const crew = await db.crew.findFirst({
    where: {
      studioWorkspaceId: workspaceId,
      deletedAt: null,
      studioWorkspace: { status: 'active', deletedAt: null },
      members: { some: { userId, status: 'active' } },
    },
    select: {
      id: true,
      members: {
        where: { userId, status: 'active' },
        select: CREW_STUDIO_MEMBER_SELECT,
        take: 1,
      },
    },
  });
  const member = crew?.members[0];
  if (!crew || !member) return null;
  const role = crewStudioRoleForMember(crew.id, userId, member);
  if (!role) return null;
  return {
    crewId: crew.id,
    workspaceId,
    userId,
    role,
    accessScope: 'workspace',
  };
}
