import { NotFoundException } from '@nestjs/common';
import { ProjectMemberRole } from '@prisma/client';
import { AgentOsProjectContextService } from './agent-os-project-context.service';

function makeService(options?: { platform?: boolean; story?: boolean }) {
  const prisma = {
    platformProject: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options?.platform
            ? { id: 'project-1', workspaceId: 'workspace-1' }
            : null,
        ),
    },
    storyProject: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options?.story
            ? { id: 'project-1', workspaceId: 'workspace-1' }
            : null,
        ),
    },
    storyChapter: {
      findFirst: jest.fn(),
    },
  };
  const storyPermissions = {
    requireProject: jest.fn().mockResolvedValue(undefined),
  };
  const workspacePermissions = {
    requireProjectRole: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AgentOsProjectContextService(
    prisma as never,
    storyPermissions as never,
    workspacePermissions as never,
  );
  return { service, prisma, storyPermissions, workspacePermissions };
}

describe('AgentOsProjectContextService', () => {
  it('resolves and authorizes a platform project', async () => {
    const { service, storyPermissions, workspacePermissions } = makeService({
      platform: true,
    });

    await expect(service.requireWrite('actor-1', 'project-1')).resolves.toEqual(
      {
        projectId: 'project-1',
        projectKind: 'platform',
        workspaceId: 'workspace-1',
      },
    );
    expect(workspacePermissions.requireProjectRole).toHaveBeenCalledWith(
      'actor-1',
      'project-1',
      ProjectMemberRole.editor,
    );
    expect(storyPermissions.requireProject).not.toHaveBeenCalled();
  });

  it('resolves and authorizes a story project', async () => {
    const { service, storyPermissions, workspacePermissions } = makeService({
      story: true,
    });

    await expect(service.requireRead('actor-1', 'project-1')).resolves.toEqual({
      projectId: 'project-1',
      projectKind: 'story',
      workspaceId: 'workspace-1',
    });
    expect(storyPermissions.requireProject).toHaveBeenCalledWith(
      'actor-1',
      'project-1',
      'story.read',
    );
    expect(workspacePermissions.requireProjectRole).not.toHaveBeenCalled();
  });

  it('fails closed for an unknown project', async () => {
    const { service } = makeService();
    await expect(service.resolve('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('accepts only a chapter that belongs to the selected Story project', async () => {
    const { service, prisma } = makeService({ story: true });
    prisma.storyChapter.findFirst.mockResolvedValue({ id: 'chapter-1' });
    await expect(
      service.requireStoryWorkbenchContext('project-1', {
        chapterId: 'chapter-1',
      }),
    ).resolves.toEqual({ chapterId: 'chapter-1' });
    expect(prisma.storyChapter.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'chapter-1',
        storyProjectId: 'project-1',
        archivedAt: null,
      },
      select: { id: true },
    });
  });

  it('fails closed when Story mode has no active chapter', async () => {
    const { service } = makeService({ story: true });
    await expect(
      service.requireStoryWorkbenchContext('project-1', undefined),
    ).rejects.toMatchObject({
      response: { code: 'AGENT_OS_STORY_CHAPTER_REQUIRED' },
    });
  });
});
