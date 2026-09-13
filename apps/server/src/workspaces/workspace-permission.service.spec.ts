import {
  ProjectMemberRole,
  WorkspaceMemberAccessScope,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
} from '@prisma/client';
import { WorkspacePermissionService } from './workspace-permission.service';

const PROJECT = {
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
};

function serviceWithWorkspaceRole(role: WorkspaceMemberRole) {
  const prisma = {
    platformProject: { findFirst: jest.fn().mockResolvedValue(PROJECT) },
    projectMember: { findFirst: jest.fn().mockResolvedValue(null) },
    workspaceMember: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'workspace-member-1',
        workspaceId: PROJECT.workspaceId,
        userId: 'user-1',
        role,
        status: WorkspaceMemberStatus.active,
        accessScope: WorkspaceMemberAccessScope.workspace,
      }),
    },
  };
  return { prisma, service: new WorkspacePermissionService(prisma as never) };
}

describe('WorkspacePermissionService project fallback', () => {
  it('keeps billing members read-only so they cannot bypass creator seats', async () => {
    const { service } = serviceWithWorkspaceRole(WorkspaceMemberRole.billing);

    await expect(
      service.requireProjectRole(
        'user-1',
        PROJECT.id,
        ProjectMemberRole.editor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'PROJECT_PERMISSION_DENIED' },
    });
  });

  it('does not let a billing member create projects or generate at workspace scope', async () => {
    const { service } = serviceWithWorkspaceRole(WorkspaceMemberRole.billing);
    await expect(
      service.requireWorkspaceRole(
        'user-1',
        PROJECT.workspaceId,
        WorkspaceMemberRole.editor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'WORKSPACE_PERMISSION_DENIED' },
    });
    await expect(
      service.requireWorkspaceRole(
        'user-1',
        PROJECT.workspaceId,
        WorkspaceMemberRole.billing,
      ),
    ).resolves.toMatchObject({ role: WorkspaceMemberRole.billing });
  });

  it('still lets billing members read workspace projects', async () => {
    const { service } = serviceWithWorkspaceRole(WorkspaceMemberRole.billing);

    await expect(
      service.requireProjectRole(
        'user-1',
        PROJECT.id,
        ProjectMemberRole.viewer,
      ),
    ).resolves.toEqual(PROJECT);
  });

  it('lets a creator-capable workspace editor edit projects', async () => {
    const { service } = serviceWithWorkspaceRole(WorkspaceMemberRole.editor);

    await expect(
      service.requireProjectRole(
        'user-1',
        PROJECT.id,
        ProjectMemberRole.editor,
      ),
    ).resolves.toEqual(PROJECT);
  });
});
