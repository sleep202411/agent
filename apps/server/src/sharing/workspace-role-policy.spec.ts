jest.mock('../users/users.service', () => ({ UsersService: class {} }));
import { ForbiddenException } from '@nestjs/common';
import { WorkspaceInvitesService } from './workspace-invites.service';
import { WorkspaceMembersService } from './workspace-members.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
jest.mock('../documents/documents.gateway', () => ({
  DocumentsGateway: class {},
}));
jest.mock('../notification', () => ({ NotificationService: class {} }));
jest.mock('../workspaces', () => ({
  PlatformAuditLogService: class {},
  WorkspacePermissionService: class {},
}));
jest.mock('../infra/realtime/realtime-revoke.service', () => ({
  RealtimeRevokeService: class {},
}));
jest.mock('./seat-guard', () => ({
  acquireSeatLock: jest.fn(),
  workspaceRoleConsumesCreatorSeat: () => false,
}));
jest.mock('./team-realtime', () => ({ enqueueTeamMemberChanged: jest.fn() }));
const invite = {
  id: 'invite',
  workspaceId: 'ws',
  role: 'admin',
  status: 'pending',
  expiresAt: new Date('2099-01-01'),
} as never;
it('reports the existing editor role and never upgrades on acceptance', async () => {
  const member = { id: 'member', role: 'editor', accessScope: 'workspace' };
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([
        { status: 'pending', expires_at: new Date('2099-01-01') },
      ]),
    crew: { findFirst: jest.fn().mockResolvedValue(null) },
    workspaceMember: {
      findFirst: jest.fn().mockResolvedValue(member),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const db = {
    workspace: {
      findFirst: jest.fn().mockResolvedValue({ id: 'ws', name: 'Team' }),
    },
    workspaceInvite: { findUnique: jest.fn().mockResolvedValue(invite) },
    $transaction: (fn: (t: typeof tx) => Promise<void>) => fn(tx),
  };
  const service = new WorkspaceInvitesService(
    db as never,
    { requireWorkspaceRole: () => Promise.resolve(member) } as never,
    { record: jest.fn() } as never,
    {} as never,
  );
  expect(await service.preview(invite, { userId: 'user' })).toMatchObject({
    currentRole: 'editor',
    existingAccess: { scope: 'workspace', targetName: 'Team' },
  });
  await service.accept(invite, { userId: 'user' });
  expect(tx.workspaceMember.update).not.toHaveBeenCalled();
  expect(tx.workspaceMember.create).not.toHaveBeenCalled();
});
it.each(['admin', 'editor', 'viewer'])(
  'rejects role changes from a non-owner %s before writing',
  async (role) => {
    const db = {
      crew: { findFirst: jest.fn().mockResolvedValue(null) },
      workspaceMember: {
        findFirst: jest.fn().mockResolvedValue({
          role,
          status: 'active',
          accessScope: 'workspace',
        }),
      },
    };
    const service = new WorkspaceMembersService(
      db as never,
      {} as never,
      {} as never,
      new WorkspacePermissionService(db as never),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.updateRole('ws', { userId: 'user' }, 'member', { role: 'admin' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  },
);
it('allows the owner to update an existing member role', async () => {
  const member = {
    id: 'member',
    userId: 'target',
    role: 'editor',
    status: 'active',
    joinedAt: new Date(),
    accessScope: 'workspace',
  };
  const tx = {
    crew: { findFirst: jest.fn().mockResolvedValue(null) },
    workspaceMember: {
      update: jest.fn().mockResolvedValue({ ...member, role: 'admin' }),
    },
  };
  const permissions = { requireWorkspaceRole: jest.fn() };
  const db = {
    crew: { findFirst: jest.fn().mockResolvedValue(null) },
    workspaceMember: { findFirst: jest.fn().mockResolvedValue(member) },
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const service = new WorkspaceMembersService(
    db as never,
    {} as never,
    {} as never,
    permissions as never,
    { record: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await service.updateRole('ws', { userId: 'owner' }, 'member', {
    role: 'admin',
  });
  expect(permissions.requireWorkspaceRole).toHaveBeenCalledWith(
    'owner',
    'ws',
    'owner',
  );
  expect(tx.workspaceMember.update).toHaveBeenCalled();
});
