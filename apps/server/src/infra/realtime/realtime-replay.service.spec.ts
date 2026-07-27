import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RealtimeReplayService } from './realtime-replay.service';

const USER_ID = 'user-1';
const PROJECT_ID = '019f7243-20c1-7054-a6fa-0a33da6efef3';
const STORY_CHANNEL = `story:project:${PROJECT_ID}`;

describe('RealtimeReplayService Story project authorization', () => {
  let findMany: jest.Mock;
  let workspacePermissions: { requireWorkspaceRole: jest.Mock };
  let storyPermissions: { requireProject: jest.Mock };
  let service: RealtimeReplayService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([
      {
        channel: STORY_CHANNEL,
        seq: 8n,
        eventId: 'event-8',
        payload: { type: 'story.agent.run.updated' },
      },
    ]);
    workspacePermissions = {
      requireWorkspaceRole: jest.fn().mockResolvedValue({}),
    };
    storyPermissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { id: PROJECT_ID },
      }),
    };
    service = new RealtimeReplayService(
      { aiEventOutbox: { findMany } } as never,
      workspacePermissions as never,
      storyPermissions as never,
    );
  });

  it('allows a story.read member to replay only the requested Story channel', async () => {
    await expect(service.replay(USER_ID, STORY_CHANNEL, 7)).resolves.toEqual({
      events: [
        {
          type: 'story.agent.run.updated',
          channel: STORY_CHANNEL,
          seq: 8,
          eventId: 'event-8',
        },
      ],
      hasMore: false,
    });

    expect(storyPermissions.requireProject).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
      'story.read',
      { allowArchived: true },
    );
    expect(workspacePermissions.requireWorkspaceRole).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith({
      where: { channel: STORY_CHANNEL, seq: { gt: 7n } },
      orderBy: { seq: 'asc' },
      take: 200,
    });
  });

  it('does not read the outbox when Story membership is denied', async () => {
    const membershipError = new NotFoundException({
      code: 'STORY_PROJECT_NOT_FOUND',
      message: 'Story project not found.',
    });
    storyPermissions.requireProject.mockRejectedValue(membershipError);

    await expect(service.replay(USER_ID, STORY_CHANNEL, 0)).rejects.toBe(
      membershipError,
    );

    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects unsupported channels before querying the outbox', async () => {
    await expect(
      service.replay(USER_ID, `story:projects:${PROJECT_ID}`, 0),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(storyPermissions.requireProject).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects replay when story.read authorization is explicitly forbidden', async () => {
    const permissionError = new ForbiddenException({
      code: 'STORY_PERMISSION_DENIED',
      message: 'Story read permission denied.',
    });
    storyPermissions.requireProject.mockRejectedValue(permissionError);

    await expect(service.replay(USER_ID, STORY_CHANNEL, 0)).rejects.toBe(
      permissionError,
    );

    expect(findMany).not.toHaveBeenCalled();
  });
});
