import { ForbiddenException } from '@nestjs/common';
import { ProjectInvitesService } from './project-invites.service';
import { WorkspaceInvitesService } from './workspace-invites.service';
import { StoryProjectInvitesService } from '../story-studio/story-project-invites.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';

const project = {
  id: 'project',
  workspaceId: 'workspace',
  name: 'Shared project',
};
const user = { userId: 'member' } as never;
const invite = {
  projectId: 'project',
  workspaceId: 'workspace',
  storyProjectId: 'story',
  role: 'viewer',
  status: 'pending',
  expiresAt: new Date('2099-01-01'),
} as never;
function projectService(direct: boolean, workspace: boolean, exists = true) {
  const prisma = {
    platformProject: {
      findFirst: jest.fn().mockResolvedValue(exists ? project : null),
    },
    projectMember: {
      findFirst: jest
        .fn()
        .mockResolvedValue(direct ? { role: 'viewer' } : null),
    },
    workspaceMember: {
      findFirst: jest
        .fn()
        .mockResolvedValue(workspace ? { role: 'editor' } : null),
    },
  };
  const service = new ProjectInvitesService(
    prisma as never,
    new WorkspacePermissionService(prisma as never),
    {} as never,
    {} as never,
  );
  return { prisma, service };
}

describe('invitation preview existing access', () => {
  it.each(['pending', 'accepted', 'revoked', 'expired'])(
    'offers entry to current project members for a %s link without accepting again',
    async (status) => {
      const { service } = projectService(true, false);
      const result = await service.preview(
        { ...(invite as object), status } as never,
        user,
      );
      expect(result.existingAccess).toEqual({
        scope: 'project',
        projectId: 'project',
        workspaceId: 'workspace',
        targetName: 'Shared project',
      });
    },
  );
  it('recognizes access inherited from workspace membership', async () => {
    const { prisma, service } = projectService(false, true);
    expect((await service.preview(invite, user)).existingAccess?.scope).toBe(
      'project',
    );
    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'member',
          status: 'active',
          removedAt: null,
          accessScope: 'workspace',
        }) as unknown,
      }),
    );
  });
  it('does not offer entry to removed or non-members', async () => {
    const { prisma, service } = projectService(false, false);
    expect((await service.preview(invite, user)).existingAccess).toBeNull();
    expect(prisma.projectMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 'project',
          userId: 'member',
          status: 'active',
          removedAt: null,
        },
      }),
    );
  });
  it('does not offer entry to a missing or inactive project', async () => {
    const { service } = projectService(true, true, false);
    expect((await service.preview(invite, user)).existingAccess).toBeNull();
  });
  it('does not disguise infrastructure failures as non-membership', async () => {
    const { prisma, service } = projectService(false, false);
    prisma.projectMember.findFirst.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(service.preview(invite, user)).rejects.toThrow(
      'database unavailable',
    );
  });
  it('offers the workspace entry only after its normal access check passes', async () => {
    const permissions = {
      requireWorkspaceRole: jest.fn().mockResolvedValue({ role: 'viewer' }),
    };
    const service = new WorkspaceInvitesService(
      {
        workspace: { findFirst: jest.fn().mockResolvedValue({ name: 'Team' }) },
      } as never,
      permissions as never,
      {} as never,
      {} as never,
    );
    expect((await service.preview(invite, user)).existingAccess).toEqual({
      scope: 'workspace',
      workspaceId: 'workspace',
      targetName: 'Team',
    });
    permissions.requireWorkspaceRole.mockRejectedValue(
      new ForbiddenException(),
    );
    expect((await service.preview(invite, user)).existingAccess).toBeNull();
  });
  it('uses story.read access and carries the story workspace into navigation', async () => {
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { id: 'story', workspaceId: 'workspace', title: 'Story' },
      }),
    };
    const service = new StoryProjectInvitesService(
      {
        storyProject: {
          findFirst: jest.fn().mockResolvedValue({ title: 'Story' }),
        },
      } as never,
      permissions as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect((await service.preview(invite, user)).existingAccess).toEqual({
      scope: 'story-project',
      storyProjectId: 'story',
      workspaceId: 'workspace',
      targetName: 'Story',
    });
    expect(permissions.requireProject).toHaveBeenCalledWith(
      'member',
      'story',
      'story.read',
    );
  });
});
