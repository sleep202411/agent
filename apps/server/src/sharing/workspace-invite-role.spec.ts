import { ForbiddenException } from '@nestjs/common';
import { WorkspaceInvitesService } from './workspace-invites.service';
import { assertCreatorSeatAvailable } from './seat-guard';
import { enqueueTeamMemberChanged } from './team-realtime';
jest.mock('./seat-guard', () => ({
  acquireSeatLock: jest.fn(),
  workspaceRoleConsumesCreatorSeat: (role: string) => role !== 'viewer',
  assertCreatorSeatAvailable: jest.fn(),
}));
jest.mock('./team-realtime', () => ({ enqueueTeamMemberChanged: jest.fn() }));
const invite = {
  id: 'invite',
  workspaceId: 'workspace',
  role: 'admin',
  status: 'pending',
  invitedById: 'owner',
  expiresAt: new Date('2099-01-01'),
} as const;
function fixture(role = 'editor') {
  const member = {
    id: 'member',
    userId: 'user',
    role,
    accessScope: 'workspace',
    status: 'active',
  };
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ status: 'pending', expires_at: invite.expiresAt }]),
    workspaceMember: {
      findFirst: jest.fn().mockResolvedValue(member),
      update: jest.fn().mockResolvedValue({ ...member, role: 'admin' }),
      create: jest.fn(),
    },
    workspaceInvite: { update: jest.fn() },
  };
  const permissions = {
    requireWorkspaceRole: jest
      .fn()
      .mockImplementation((_user: string, _ws: string, min: string) => {
        if (min === 'admin' && role === 'editor')
          throw new ForbiddenException();
        return Promise.resolve(member);
      }),
  };
  const db = {
    workspace: {
      findFirst: jest.fn().mockResolvedValue({ id: 'workspace', name: 'Team' }),
    },
    workspaceInvite: {
      findUnique: jest.fn().mockResolvedValue(invite),
      update: jest.fn(),
    },
    $transaction: jest.fn((work: (db: typeof tx) => Promise<void>) => work(tx)),
  };
  const audit = { record: jest.fn() };
  return {
    tx,
    db,
    audit,
    permissions,
    service: new WorkspaceInvitesService(
      db as never,
      permissions as never,
      audit as never,
      {} as never,
    ),
  };
}
beforeEach(() => jest.clearAllMocks());
it('offers acceptance instead of bypassing an admin invitation for an editor', async () => {
  const { service } = fixture();
  expect(
    (await service.preview(invite as never, { userId: 'user' })).existingAccess,
  ).toBeNull();
});
it('upgrades an editor and publishes a role change without replacing membership history', async () => {
  const { service, tx, audit } = fixture();
  await service.accept(invite as never, { userId: 'user' });
  expect(tx.workspaceMember.update).toHaveBeenCalledWith({
    where: { id: 'member' },
    data: { role: 'admin' },
  });
  expect(tx.workspaceMember.create).not.toHaveBeenCalled();
  expect(assertCreatorSeatAvailable).toHaveBeenCalled();
  expect(enqueueTeamMemberChanged).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({ action: 'role_changed' }),
  );
  expect(audit.record).toHaveBeenCalledWith(
    expect.objectContaining({
      after: expect.objectContaining({
        upgraded: true,
        created: false,
      }) as unknown,
    }),
  );
});
it.each(['admin', 'owner'])(
  'preserves an existing %s and offers direct entry',
  async (role) => {
    const { service, tx } = fixture(role);
    expect(
      (await service.preview(invite as never, { userId: 'user' }))
        .existingAccess?.scope,
    ).toBe('workspace');
    await service.accept(invite as never, { userId: 'user' });
    expect(tx.workspaceMember.update).not.toHaveBeenCalled();
  },
);
it.each(['revoked', 'expired'])(
  'never grants a role through a %s invitation',
  async (status) => {
    const { service, db, tx } = fixture();
    db.workspaceInvite.findUnique.mockResolvedValue({
      ...invite,
      status,
    });
    await expect(
      service.accept(invite as never, { userId: 'user' }),
    ).rejects.toThrow();
    expect(tx.workspaceMember.update).not.toHaveBeenCalled();
  },
);
it('rejects a revoke that happens between lookup and the locked check', async () => {
  const { service, tx } = fixture();
  tx.$queryRaw.mockResolvedValue([
    { status: 'revoked', expires_at: invite.expiresAt },
  ]);
  await expect(
    service.accept(invite as never, { userId: 'user' }),
  ).rejects.toThrow();
  expect(tx.workspaceMember.update).not.toHaveBeenCalled();
});
it('does not treat editor access as successful recovery from a failed admin upgrade', async () => {
  const { service, db, audit } = fixture();
  db.$transaction.mockRejectedValue({ code: 'P2002' });
  await expect(
    service.accept(invite as never, { userId: 'user' }),
  ).rejects.toMatchObject({ code: 'P2002' });
  expect(audit.record).not.toHaveBeenCalled();
});
it('retains direct entry through an inactive link without promising an upgrade', async () => {
  const { service } = fixture();
  expect(
    (
      await service.preview({ ...invite, status: 'revoked' } as never, {
        userId: 'user',
      })
    ).existingAccess?.scope,
  ).toBe('workspace');
});
it('does not bypass a seat admission failure when upgrading a viewer', async () => {
  const { service, tx } = fixture('viewer');
  jest
    .mocked(assertCreatorSeatAvailable)
    .mockRejectedValueOnce(new ForbiddenException('seat required'));
  await expect(
    service.accept(invite as never, { userId: 'user' }),
  ).rejects.toThrow('seat required');
  expect(tx.workspaceMember.update).not.toHaveBeenCalled();
});
it('does not reinstate a removed member through the shared link', async () => {
  const { service, tx } = fixture();
  tx.workspaceMember.findFirst
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: 'removed' });
  await expect(
    service.accept(invite as never, { userId: 'user' }),
  ).rejects.toMatchObject({ response: { code: 'REMOVED_CANNOT_REJOIN' } });
  expect(tx.workspaceMember.update).not.toHaveBeenCalled();
});
it('still grants administrator membership to a new recipient', async () => {
  const { service, tx } = fixture();
  tx.workspaceMember.findFirst.mockResolvedValue(null);
  tx.workspaceMember.create.mockResolvedValue({
    id: 'new-member',
    userId: 'user',
    role: 'admin',
    status: 'active',
  });
  await service.accept(invite as never, { userId: 'user' });
  expect(tx.workspaceMember.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        role: 'admin',
        accessScope: 'workspace',
      }) as unknown,
    }),
  );
  expect(tx.workspaceMember.update).not.toHaveBeenCalled();
});
