import { ProjectMemberRole } from '@prisma/client';
import { ProjectSkillsService } from './project-skills.service';

function createService() {
  const prisma = {
    skillCatalogItem: { findMany: jest.fn() },
    projectSkillState: { findFirst: jest.fn() },
    workspaceMember: { findFirst: jest.fn() },
  };
  const workspacePermissions = {
    requireProjectRole: jest.fn(),
    resolveEffectiveProjectRole: jest.fn(),
  };
  const service = new ProjectSkillsService(
    prisma as never,
    workspacePermissions as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, workspacePermissions };
}

describe('ProjectSkillsService catalog access boundary', () => {
  it('queries only public, same-workspace, or current-project Skills', async () => {
    const { service, prisma, workspacePermissions } = createService();
    workspacePermissions.requireProjectRole.mockResolvedValue({
      id: '10000000-0000-7000-8000-000000000001',
      workspaceId: '20000000-0000-7000-8000-000000000001',
    });
    workspacePermissions.resolveEffectiveProjectRole.mockResolvedValue(
      ProjectMemberRole.owner,
    );
    prisma.skillCatalogItem.findMany.mockResolvedValue([]);
    prisma.projectSkillState.findFirst.mockResolvedValue(null);
    prisma.workspaceMember.findFirst.mockResolvedValue({ id: 'membership' });

    const response = await service.listCatalog(
      { userId: 'user-1' },
      'platform',
      '10000000-0000-7000-8000-000000000001',
      {},
    );

    expect(response).toMatchObject({
      canManage: true,
      canManageWorkspace: true,
      items: [],
    });
    type CatalogFindManyInput = {
      where: { AND: Array<{ OR?: unknown }> };
    };
    const calls = prisma.skillCatalogItem.findMany.mock
      .calls as unknown as Array<[CatalogFindManyInput]>;
    expect(calls[0]?.[0].where.AND[0]?.OR).toEqual([
      { visibility: 'public' },
      {
        visibility: 'unlisted',
        workspaceId: '20000000-0000-7000-8000-000000000001',
        platformProjectId: null,
        storyProjectId: null,
      },
      {
        visibility: 'private',
        workspaceId: '20000000-0000-7000-8000-000000000001',
        platformProjectId: '10000000-0000-7000-8000-000000000001',
        storyProjectId: null,
      },
    ]);
  });
});
