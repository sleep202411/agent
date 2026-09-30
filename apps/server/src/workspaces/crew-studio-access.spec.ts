import { resolveCrewStudioAccess } from './crew-studio-access';
import { WorkspacePermissionService } from './workspace-permission.service';

function fixture() {
  const member = {
    id: 'member',
    ownership: null as { crewId: string } | null,
    policies: [] as Array<{ policyKey: string }>,
    permissionOverrides: [] as Array<{ permissionKey: string; effect: string }>,
  };
  const crew = { id: 'crew', members: [member] };
  const db = {
    crew: { findFirst: jest.fn().mockResolvedValue(crew) },
    workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
    platformProject: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'project', workspaceId: 'workspace' }),
    },
    projectMember: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  return {
    db,
    crew,
    member,
    service: new WorkspacePermissionService(db as never),
  };
}

it('grants active production members read access without manufacturing a workspace membership', async () => {
  const f = fixture();
  await expect(
    f.service.requireWorkspaceRole('user', 'workspace', 'viewer'),
  ).resolves.toMatchObject({ role: 'viewer', workspaceId: 'workspace' });
  expect(f.db.crew.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        studioWorkspaceId: 'workspace',
        deletedAt: null,
        studioWorkspace: { status: 'active', deletedAt: null },
        members: { some: { userId: 'user', status: 'active' } },
      },
    }),
  );
  await expect(
    f.service.requireWorkspaceRole('user', 'workspace', 'editor'),
  ).rejects.toMatchObject({
    response: { code: 'WORKSPACE_PERMISSION_DENIED' },
  });
});

it('honors explicit studio.edit allow and deny overrides using the canonical crew policy', async () => {
  const f = fixture();
  f.member.permissionOverrides = [
    { permissionKey: 'studio.edit', effect: 'allow' },
  ];
  await expect(
    resolveCrewStudioAccess(f.db as never, 'workspace', 'user'),
  ).resolves.toMatchObject({ role: 'editor' });
  f.member.policies = [{ policyKey: 'admin' }];
  f.member.permissionOverrides = [
    { permissionKey: 'studio.edit', effect: 'deny' },
  ];
  await expect(
    resolveCrewStudioAccess(f.db as never, 'workspace', 'user'),
  ).resolves.toMatchObject({ role: 'viewer' });
});

it('never turns crew ownership into workspace ownership or billing administration', async () => {
  const f = fixture();
  f.member.ownership = { crewId: 'crew' };
  await expect(
    f.service.requireWorkspaceRole('user', 'workspace', 'editor'),
  ).resolves.toMatchObject({ role: 'editor' });
  for (const role of ['owner', 'admin', 'billing'] as const) {
    await expect(
      f.service.requireWorkspaceRole('user', 'workspace', role),
    ).rejects.toMatchObject({
      response: { code: 'WORKSPACE_PERMISSION_DENIED' },
    });
  }
});

it('re-evaluates removal/unlink instead of retaining a copied grant', async () => {
  const f = fixture();
  await expect(
    f.service.requireWorkspacePresence('user', 'workspace'),
  ).resolves.toMatchObject({ role: 'viewer' });
  f.db.crew.findFirst.mockResolvedValue(null);
  await expect(
    f.service.requireWorkspacePresence('user', 'workspace'),
  ).rejects.toMatchObject({ response: { code: 'WORKSPACE_ACCESS_DENIED' } });
});

it('preserves independent access after the crew grant disappears', async () => {
  const f = fixture();
  const independent = {
    workspaceId: 'workspace',
    userId: 'user',
    role: 'viewer',
    accessScope: 'workspace',
  };
  f.db.workspaceMember.findFirst.mockResolvedValue(independent);
  f.db.crew.findFirst.mockResolvedValue(null);
  await expect(
    f.service.requireWorkspacePresence('user', 'workspace'),
  ).resolves.toEqual(independent);
});

it('unions independent billing and crew editing without granting administration', async () => {
  const f = fixture();
  f.db.workspaceMember.findFirst.mockResolvedValue({
    workspaceId: 'workspace',
    userId: 'user',
    role: 'billing',
    accessScope: 'workspace',
  });
  f.member.permissionOverrides = [
    { permissionKey: 'studio.edit', effect: 'allow' },
  ];
  await expect(
    f.service.requireWorkspaceRole('user', 'workspace', 'billing'),
  ).resolves.toMatchObject({ role: 'billing' });
  await expect(
    f.service.requireWorkspaceRole('user', 'workspace', 'editor'),
  ).resolves.toMatchObject({ role: 'editor' });
  await expect(
    f.service.requireProjectRole('user', 'project', 'editor'),
  ).resolves.toMatchObject({ id: 'project' });
  await expect(
    f.service.resolveEffectiveProjectRole('user', { id: 'project' } as never),
  ).resolves.toBe('editor');
  await expect(
    f.service.requireWorkspaceRole('user', 'workspace', 'admin'),
  ).rejects.toMatchObject({
    response: { code: 'WORKSPACE_PERMISSION_DENIED' },
  });
});

it('does not confuse an empty active-member result with community membership', async () => {
  const f = fixture();
  f.crew.members = [];
  await expect(
    resolveCrewStudioAccess(f.db as never, 'workspace', 'user'),
  ).resolves.toBeNull();
});
