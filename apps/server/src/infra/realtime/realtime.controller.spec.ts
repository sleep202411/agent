import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WorkspaceMemberRole } from '@prisma/client';
import { RealtimeController } from './realtime.controller';

const USER_ID = 'user-1';
const USER = { userId: USER_ID };
const WORKSPACE_ID = '019f7243-20c1-7054-a6fa-0a33da6efef1';
const OTHER_WORKSPACE_ID = '019f7243-20c1-7054-a6fa-0a33da6efef2';
const PROJECT_ID = '019f7243-20c1-7054-a6fa-0a33da6efef3';

describe('RealtimeController Story project authorization', () => {
  let realtime: { issueRealtimeClientAccess: jest.Mock };
  let workspacePermissions: { requireWorkspaceRole: jest.Mock };
  let storyPermissions: { requireProject: jest.Mock };
  let controller: RealtimeController;

  beforeEach(() => {
    realtime = {
      issueRealtimeClientAccess: jest.fn().mockResolvedValue({
        url: '/aurora/realtime/connect',
        accessToken: 'realtime-token',
        expiresAt: 1_000_000,
        transport: 'self-hosted',
      }),
    };
    workspacePermissions = {
      requireWorkspaceRole: jest.fn().mockResolvedValue({}),
    };
    storyPermissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      }),
    };
    controller = new RealtimeController(
      realtime as never,
      workspacePermissions as never,
      storyPermissions as never,
      {} as never,
    );
  });

  it('requires an active workspace before granting Story project realtime', async () => {
    await expect(
      controller.negotiateRealtime(
        USER as never,
        undefined,
        `  ${PROJECT_ID}  `,
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_REALTIME_WORKSPACE_REQUIRED' },
    });

    expect(workspacePermissions.requireWorkspaceRole).not.toHaveBeenCalled();
    expect(storyPermissions.requireProject).not.toHaveBeenCalled();
    expect(realtime.issueRealtimeClientAccess).not.toHaveBeenCalled();
  });

  it('requires both workspace viewer access and story.read membership', async () => {
    await controller.negotiateRealtime(
      USER as never,
      `  ${WORKSPACE_ID}  `,
      `  ${PROJECT_ID}  `,
    );

    expect(workspacePermissions.requireWorkspaceRole).toHaveBeenCalledWith(
      USER_ID,
      WORKSPACE_ID,
      WorkspaceMemberRole.viewer,
    );
    expect(storyPermissions.requireProject).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
      'story.read',
      { allowArchived: true },
    );
  });

  it('does not check or grant Story access when workspace access is denied', async () => {
    const workspaceError = new ForbiddenException('workspace_forbidden');
    workspacePermissions.requireWorkspaceRole.mockRejectedValue(workspaceError);

    await expect(
      controller.negotiateRealtime(USER as never, WORKSPACE_ID, PROJECT_ID),
    ).rejects.toBe(workspaceError);

    expect(storyPermissions.requireProject).not.toHaveBeenCalled();
    expect(realtime.issueRealtimeClientAccess).not.toHaveBeenCalled();
  });

  it('does not issue access when Story membership is denied', async () => {
    const membershipError = new NotFoundException({
      code: 'STORY_PROJECT_NOT_FOUND',
      message: 'Story project not found.',
    });
    storyPermissions.requireProject.mockRejectedValue(membershipError);

    await expect(
      controller.negotiateRealtime(USER as never, WORKSPACE_ID, PROJECT_ID),
    ).rejects.toBe(membershipError);

    expect(realtime.issueRealtimeClientAccess).not.toHaveBeenCalled();
  });

  it('hides a Story project that belongs to a different workspace', async () => {
    storyPermissions.requireProject.mockResolvedValue({
      project: { id: PROJECT_ID, workspaceId: OTHER_WORKSPACE_ID },
    });

    await expect(
      controller.negotiateRealtime(USER as never, WORKSPACE_ID, PROJECT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(realtime.issueRealtimeClientAccess).not.toHaveBeenCalled();
  });

  it('passes the authorized Story project id to the realtime provider', async () => {
    await expect(
      controller.negotiateRealtime(USER as never, WORKSPACE_ID, PROJECT_ID),
    ).resolves.toEqual({
      code: 200,
      data: {
        url: '/aurora/realtime/connect',
        accessToken: 'realtime-token',
        expiresAt: 1_000_000,
        transport: 'self-hosted',
      },
    });

    expect(realtime.issueRealtimeClientAccess).toHaveBeenCalledWith(
      USER_ID,
      WORKSPACE_ID,
      PROJECT_ID,
    );
  });

  it('treats a blank workspace header as missing for Story realtime', async () => {
    await expect(
      controller.negotiateRealtime(USER as never, '   ', PROJECT_ID),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storyPermissions.requireProject).not.toHaveBeenCalled();
    expect(realtime.issueRealtimeClientAccess).not.toHaveBeenCalled();
  });
});
