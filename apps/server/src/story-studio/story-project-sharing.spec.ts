import { ForbiddenException } from '@nestjs/common';
import {
  StoryProjectMemberRole,
  WorkspaceMemberRole,
  WorkspaceType,
} from '@prisma/client';
import { ensureWorkspaceMembershipForStory } from './story-project-membership';
import { StoryProjectMembersService } from './story-project-members.service';
import { STORY_ROLE_MAP } from './story-project-sharing.dto';

const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const OWNER = { userId: 'owner-1' } as never;

function tx(overrides: {
  workspaceType?: WorkspaceType;
  workspaceMember?: {
    id: string;
    status: string;
    removedAt: Date | null;
  } | null;
}) {
  const workspaceMemberCreate = jest.fn().mockResolvedValue({ id: 'wm-new' });
  const workspaceMemberUpdate = jest.fn().mockResolvedValue({ id: 'wm-old' });
  const workspaceMemberCount = jest.fn().mockResolvedValue(1);
  return {
    calls: {
      workspaceMemberCreate,
      workspaceMemberUpdate,
      workspaceMemberCount,
    },
    client: {
      $executeRaw: jest.fn().mockResolvedValue(0),
      workspace: {
        // The row still carries `type` even though the function stopped reading
        // it — that is exactly what the personal-workspace case pins.
        findFirst: jest.fn().mockResolvedValue({
          id: WORKSPACE_ID,
          type: overrides.workspaceType ?? WorkspaceType.team,
        }),
      },
      workspaceMember: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            overrides.workspaceMember === undefined
              ? null
              : overrides.workspaceMember,
          ),
        count: workspaceMemberCount,
        create: workspaceMemberCreate,
        update: workspaceMemberUpdate,
      },
    } as never,
  };
}

const entitlements = {
  resolveWorkspaceSeatPolicy: jest.fn().mockResolvedValue({
    planKey: 'team',
    includedSeats: 10,
    maxSeats: 10,
    seatPriceId: null,
  }),
} as never;

describe('ensureWorkspaceMembershipForStory', () => {
  it('enrols a brand-new collaborator as a workspace viewer', async () => {
    const t = tx({});
    const result = await ensureWorkspaceMembershipForStory(t.client, {
      workspaceId: WORKSPACE_ID,
      userId: 'guest-1',
      actorUserId: 'owner-1',
      entitlements,
      allowReactivatingRemoved: true,
    });

    expect(result).toEqual({ created: true });
    expect(t.calls.workspaceMemberCreate).toHaveBeenCalledTimes(1);
    // Least privilege: the story role carries the story powers; the workspace
    // row exists only to satisfy the tenant fence.
    expect(t.calls.workspaceMemberCreate.mock.calls[0][0].data.role).toBe(
      WorkspaceMemberRole.viewer,
    );
  });

  it('is a no-op when the user already holds an active seat', async () => {
    const t = tx({
      workspaceMember: { id: 'wm-1', status: 'active', removedAt: null },
    });
    const result = await ensureWorkspaceMembershipForStory(t.client, {
      workspaceId: WORKSPACE_ID,
      userId: 'teammate-1',
      actorUserId: 'owner-1',
      entitlements,
      allowReactivatingRemoved: true,
    });

    expect(result).toEqual({ created: false });
    expect(t.calls.workspaceMemberCreate).not.toHaveBeenCalled();
    expect(t.calls.workspaceMemberUpdate).not.toHaveBeenCalled();
  });

  it('enrols into a PERSONAL workspace too — seats decide, not workspace type', async () => {
    const t = tx({ workspaceType: WorkspaceType.personal });
    const result = await ensureWorkspaceMembershipForStory(t.client, {
      workspaceId: WORKSPACE_ID,
      userId: 'guest-1',
      actorUserId: 'owner-1',
      entitlements,
      allowReactivatingRemoved: true,
    });

    expect(result).toEqual({ created: true });
    expect(t.calls.workspaceMemberCreate).toHaveBeenCalledTimes(1);
    // The seat guard still ran: story sharing consumes a seat on every type.
    expect(t.calls.workspaceMemberCount).toHaveBeenCalledTimes(1);
  });

  it('will not let an open invite link resurrect an offboarded teammate', async () => {
    const t = tx({
      workspaceMember: {
        id: 'wm-2',
        status: 'removed',
        removedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await expect(
      ensureWorkspaceMembershipForStory(t.client, {
        workspaceId: WORKSPACE_ID,
        userId: 'ex-teammate',
        actorUserId: 'owner-1',
        entitlements,
        // Accepting a link, not an admin deliberately re-granting.
        allowReactivatingRemoved: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.calls.workspaceMemberUpdate).not.toHaveBeenCalled();
  });

  it('lets an admin deliberately re-add someone by account', async () => {
    const t = tx({
      workspaceMember: {
        id: 'wm-3',
        status: 'removed',
        removedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const result = await ensureWorkspaceMembershipForStory(t.client, {
      workspaceId: WORKSPACE_ID,
      userId: 'ex-teammate',
      actorUserId: 'owner-1',
      entitlements,
      allowReactivatingRemoved: true,
    });

    expect(result).toEqual({ created: true });
    expect(t.calls.workspaceMemberUpdate).toHaveBeenCalledTimes(1);
    expect(t.calls.workspaceMemberUpdate.mock.calls[0][0].data).toMatchObject({
      removedAt: null,
      seatAssigned: true,
    });
  });
});

describe('STORY_ROLE_MAP', () => {
  it('never exposes owner as an assignable role', () => {
    expect(Object.values(STORY_ROLE_MAP)).not.toContain(
      StoryProjectMemberRole.owner,
    );
    expect(Object.keys(STORY_ROLE_MAP).sort()).toEqual([
      'editor',
      'producer',
      'reviewer',
      'viewer',
    ]);
  });
});

describe('StoryProjectMembersService', () => {
  function fixture() {
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { id: PROJECT_ID, workspaceId: WORKSPACE_ID, title: 'Story' },
        role: StoryProjectMemberRole.owner,
      }),
    };
    const prisma = {
      storyProjectMember: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const users = {
      lookupByUserIds: jest.fn().mockResolvedValue([]),
      lookupByContact: jest.fn().mockResolvedValue(null),
    };
    const service = new StoryProjectMembersService(
      prisma as never,
      permissions as never,
      users as never,
      { send: jest.fn() } as never,
      { record: jest.fn() } as never,
      entitlements,
    );
    return { service, permissions, prisma, users };
  }

  it('lists through the story read gate, not a workspace role', async () => {
    const { service, permissions } = fixture();
    await service.list(PROJECT_ID, OWNER, 'cookie');
    expect(permissions.requireProject).toHaveBeenCalledWith(
      'owner-1',
      PROJECT_ID,
      'story.read',
    );
  });

  it('requires story.admin to add a collaborator', async () => {
    const { service, permissions } = fixture();
    await expect(
      service.add(PROJECT_ID, OWNER, 'cookie', {
        account: 'someone@example.com',
        role: 'viewer',
      }),
    ).rejects.toMatchObject({ response: { code: 'USER_NOT_FOUND' } });
    expect(permissions.requireProject).toHaveBeenCalledWith(
      'owner-1',
      PROJECT_ID,
      'story.admin',
    );
  });

  it('refuses to re-role the owner', async () => {
    const { service, prisma } = fixture();
    prisma.storyProjectMember.findFirst.mockResolvedValue({
      id: 'm-owner',
      userId: 'owner-1',
      role: StoryProjectMemberRole.owner,
    });
    await expect(
      service.updateRole(PROJECT_ID, OWNER, 'm-owner', { role: 'viewer' }),
    ).rejects.toMatchObject({ response: { code: 'CANNOT_MODIFY_OWNER' } });
    expect(prisma.storyProjectMember.update).not.toHaveBeenCalled();
  });

  it('refuses to remove the owner', async () => {
    const { service, prisma } = fixture();
    prisma.storyProjectMember.findFirst.mockResolvedValue({
      id: 'm-owner',
      userId: 'owner-1',
      role: StoryProjectMemberRole.owner,
    });
    await expect(
      service.remove(PROJECT_ID, OWNER, 'm-owner'),
    ).rejects.toMatchObject({ response: { code: 'CANNOT_REMOVE_OWNER' } });
    expect(prisma.storyProjectMember.update).not.toHaveBeenCalled();
  });
});
