import { WorkspacesService } from './workspaces.service';
import { WorkspacePermissionService } from './workspace-permission.service';

function fixture() {
  const workspace = {
    id: 'workspace',
    name: 'Production',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
  };
  const member = {
    id: 'member',
    ownership: null,
    policies: [],
    permissionOverrides: [] as Array<{ permissionKey: string; effect: string }>,
  };
  const db = {
    workspaceMember: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    crew: {
      findMany: jest.fn().mockResolvedValue([{ studioWorkspace: workspace }]),
      findFirst: jest.fn().mockResolvedValue({ id: 'crew', members: [member] }),
    },
    workspace: { findFirst: jest.fn().mockResolvedValue(workspace) },
  };
  const permissions = new WorkspacePermissionService(db as never);
  const service = new WorkspacesService(
    db as never,
    {} as never,
    {} as never,
    permissions,
    {} as never,
    {} as never,
  );
  return { service, db, member, workspace };
}

it('discovers a linked workspace and opens it without an independent membership row', async () => {
  const { service, db } = fixture();
  const user = { userId: 'user' } as never;
  await expect(service.listForUser(user)).resolves.toMatchObject({
    workspaces: [{ id: 'workspace', role: 'viewer', accessScope: 'workspace' }],
  });
  await expect(service.getWorkspace(user, 'workspace')).resolves.toMatchObject({
    workspace: { id: 'workspace', role: 'viewer' },
  });
  expect(db.crew.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        deletedAt: null,
        studioWorkspace: { status: 'active', deletedAt: null },
        members: { some: { userId: 'user', status: 'active' } },
      },
    }),
  );
});

it('does not duplicate a workspace or downgrade an independent billing grant', async () => {
  const { service, db, member, workspace } = fixture();
  member.permissionOverrides = [
    { permissionKey: 'studio.edit', effect: 'allow' },
  ];
  const independent = {
    workspaceId: 'workspace',
    userId: 'user',
    role: 'billing',
    accessScope: 'workspace',
    workspace,
  };
  db.workspaceMember.findMany.mockResolvedValue([independent]);
  db.workspaceMember.findFirst.mockResolvedValue(independent);
  await expect(
    service.listForUser({ userId: 'user' } as never),
  ).resolves.toMatchObject({
    workspaces: [{ id: 'workspace', role: 'billing', crewRole: 'editor' }],
  });
  expect(
    (await service.listForUser({ userId: 'user' } as never)).workspaces,
  ).toHaveLength(1);
});

it('omits explicitly denied crew access without breaking the workspace list', async () => {
  const { service, member } = fixture();
  member.permissionOverrides = [
    { permissionKey: 'studio.view', effect: 'deny' },
  ];
  await expect(
    service.listForUser({ userId: 'user' } as never),
  ).resolves.toEqual({ workspaces: [] });
});
