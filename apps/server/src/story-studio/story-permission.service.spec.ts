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
        members: [{ role: StoryProjectMemberRole.owner }],
      }),
    },
  };
  const workspacePermissions = {
    requireWorkspacePresence: jest.fn().mockResolvedValue(undefined),
    requireWorkspaceRole: jest.fn().mockResolvedValue(undefined),
  };
  const writeGuard = {
    assertHumanWriteAllowedEarly: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new StoryPermissionService(
      prisma as never,
      workspacePermissions as never,
      writeGuard as never,
    ),
    writeGuard,
  };
}

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
