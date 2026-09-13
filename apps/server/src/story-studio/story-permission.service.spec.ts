import {
  StoryFrameProfile,
  StoryProjectMemberRole,
  StoryProjectStatus,
  StoryVisibility,
} from '@prisma/client';
import { StoryPermissionService } from './story-permission.service';

const USER_ID = 'user-1';
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const NOW = new Date('2026-07-18T12:00:00.000Z');

function fixture() {
  const prisma = {
    storyProject: {
      findFirst: jest.fn().mockResolvedValue({
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        frameProfile: StoryFrameProfile.landscape_16_9,
        status: StoryProjectStatus.active,
        visibility: StoryVisibility.private,
        title: 'Story',
        summary: null,
        defaultLocale: 'en-US',
        coverAssetId: null,
        tags: [],
        sourceIpId: null,
        nextBuildNumber: 1,
        version: 0,
        createdByUserId: USER_ID,
        archivedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        workspace: { members: [] },
        members: [{ role: StoryProjectMemberRole.owner }],
      }),
    },
  };
  const writeGuard = {
    assertHumanWriteAllowedEarly: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new StoryPermissionService(prisma as never, writeGuard as never),
    prisma,
    writeGuard,
  };
}

describe('StoryPermissionService project scope', () => {
  it('authorizes from active Story project membership without a Workspace lookup', async () => {
    const { service } = fixture();

    await expect(
      service.requireProject(USER_ID, PROJECT_ID, 'story.read'),
    ).resolves.toMatchObject({
      project: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      role: StoryProjectMemberRole.owner,
    });
  });

  it('fails closed when the actor is not an active Story project member', async () => {
    const { service, prisma } = fixture();
    prisma.storyProject.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.requireProject(USER_ID, PROJECT_ID, 'story.read'),
    ).rejects.toMatchObject({
      response: { code: 'STORY_PROJECT_NOT_FOUND' },
    });
  });

  it('re-checks project and workspace memberships on the authoritative write snapshot', async () => {
    const { service } = fixture();
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: PROJECT_ID }])
      .mockResolvedValueOnce([{ role: StoryProjectMemberRole.owner }])
      .mockResolvedValueOnce([]);
    const tx = {
      $queryRaw: query,
      storyProject: {
        findUnique: jest.fn().mockResolvedValue({
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
        }),
      },
    };

    await expect(
      service.requireProjectInTransaction(
        tx as never,
        USER_ID,
        PROJECT_ID,
        'story.generate',
      ),
    ).resolves.toMatchObject({ role: StoryProjectMemberRole.owner });

    const sql = query.mock.calls
      .map(([parts]) => (parts as TemplateStringsArray).join(''))
      .join('\n');
    expect(sql).toContain('story_project_members');
    expect(sql).toContain('workspace_members');
    expect(sql).toContain('workspaces');
  });
});

describe('StoryPermissionService write-lock preflight', () => {
  it.each([
    'story.edit',
    'story.generate',
    'story.review',
    'story.build',
    'story.release',
    'story.admin',
  ] as const)(
    'checks the project write state after authorizing %s',
    async (capability) => {
      const { service, writeGuard } = fixture();

      await service.requireProject(USER_ID, PROJECT_ID, capability);

      expect(writeGuard.assertHumanWriteAllowedEarly).toHaveBeenCalledWith(
        PROJECT_ID,
      );
    },
  );

  it('does not block read-only access on the Agent write state', async () => {
    const { service, writeGuard } = fixture();

    await service.requireProject(USER_ID, PROJECT_ID, 'story.read');

    expect(writeGuard.assertHumanWriteAllowedEarly).not.toHaveBeenCalled();
  });
});

describe('combined project and workspace permissions', () => {
  it.each(['editor', 'admin', 'owner'] as const)(
    'does not downgrade workspace %s with an old project viewer grant',
    async (workspaceRole) => {
      const { service, prisma } = fixture();
      const project = (await prisma.storyProject.findFirst()) as Record<
        string,
        unknown
      >;
      prisma.storyProject.findFirst.mockResolvedValueOnce({
        ...project,
        members: [{ role: 'viewer' }],
        workspace: { members: [{ role: workspaceRole }] },
      } as never);
      const access = await service.requireProject(
        USER_ID,
        PROJECT_ID,
        'story.edit',
      );
      expect(access.capabilities).toContain('story.generate');
    },
  );

  it('unions grants without inventing release or ownership powers', () => {
    const { service } = fixture();
    const access = service.effectiveAccess('reviewer', 'editor');
    expect(access?.capabilities).toEqual(
      expect.arrayContaining(['story.edit', 'story.generate', 'story.review']),
    );
    expect(access?.capabilities).not.toContain('story.release');
    expect(access?.capabilities).not.toContain('story.admin');
    expect(service.effectiveAccess('viewer', 'viewer')?.capabilities).toEqual([
      'story.read',
    ]);
    expect(service.effectiveAccess(undefined, undefined)).toBeNull();
  });

  it('unions permissions on the locked mutation snapshot too', async () => {
    const { service } = fixture();
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: PROJECT_ID }])
        .mockResolvedValueOnce([{ role: 'viewer' }])
        .mockResolvedValueOnce([{ role: 'editor' }]),
      storyProject: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: PROJECT_ID, workspaceId: WORKSPACE_ID }),
      },
    };
    await expect(
      service.requireProjectInTransaction(
        tx as never,
        USER_ID,
        PROJECT_ID,
        'story.edit',
      ),
    ).resolves.toMatchObject({ role: 'editor' });
  });
});
