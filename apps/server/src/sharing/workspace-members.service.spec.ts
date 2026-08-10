import {
  ProjectMemberStatus,
  WorkspaceMemberAccessScope,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
  WorkspaceType,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { EntitlementService } from '../entitlements/entitlement.service';
import { WorkspaceMembersService } from './workspace-members.service';

const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const ACTOR = { userId: 'owner-1' } as AuthUser;
const COOKIE = 'satoken=abc';

/**
 * The seat policy is resolved by the REAL EntitlementService here: what these
 * cover is that a personal workspace reaches the seat gate at all, and that the
 * gate is the only thing that can refuse it.
 */
function build() {
  const memberCreate = jest.fn().mockResolvedValue({
    id: 'wm-new',
    userId: 'guest-1',
    role: WorkspaceMemberRole.viewer,
    status: WorkspaceMemberStatus.active,
    joinedAt: new Date('2026-07-26T00:00:00.000Z'),
  });
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ user_id: ACTOR.userId, next_seq: 2n }]),
    entitlementGrant: { findMany: jest.fn().mockResolvedValue([]) },
    billingMembershipPlan: { findMany: jest.fn().mockResolvedValue([]) },
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ type: WorkspaceType.personal }),
    },
    workspaceMember: {
      create: memberCreate,
      update: jest.fn(),
    },
    projectMember: { findFirst: jest.fn().mockResolvedValue(null) },
    storyProjectMember: { findFirst: jest.fn().mockResolvedValue(null) },
    aiEventOutbox: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    workspace: {
      // The row still carries `type` even though add() stopped reading it —
      // that is exactly what this fixture pins.
      findFirst: jest.fn().mockResolvedValue({
        id: WORKSPACE_ID,
        name: 'My workspace',
        type: WorkspaceType.personal,
        ownerUserId: ACTOR.userId,
      }),
    },
    workspaceMember: { findFirst: jest.fn().mockResolvedValue(null) },
    platformDocument: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)),
  };
  const notifications = { send: jest.fn().mockResolvedValue({}) };
  const users = {
    lookupByContact: jest.fn().mockResolvedValue({
      userId: 'guest-1',
      nickname: 'Guest',
      avatar: null,
    }),
  };
  const permissions = { requireWorkspaceRole: jest.fn() };
  const audit = { record: jest.fn() };
  const docs = { revokeUserFromDocuments: jest.fn() };
  const realtime = { revokeWorkspaceAccess: jest.fn() };
  return {
    tx,
    prisma,
    notifications,
    audit,
    memberCreate,
    docs,
    realtime,
    service: new WorkspaceMembersService(
      prisma as never,
      notifications as never,
      users as never,
      permissions as never,
      audit as never,
      docs as never,
      new EntitlementService({} as never),
      realtime as never,
    ),
  };
}

describe('WorkspaceMembersService.add on a personal workspace', () => {
  it('adds a viewer without consuming a creator seat', async () => {
    const t = build();
    const input = { account: 'guest@example.com', role: 'viewer' } as const;

    const member = await t.service.add(WORKSPACE_ID, ACTOR, COOKIE, input);

    expect(member).toMatchObject({ memberId: 'wm-new', userId: 'guest-1' });
    expect(t.memberCreate).toHaveBeenCalledTimes(1);
    const calls = t.memberCreate.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(calls[0][0].data).toMatchObject({
      workspaceId: WORKSPACE_ID,
      userId: 'guest-1',
      role: WorkspaceMemberRole.viewer,
    });
    expect(t.notifications.send).toHaveBeenCalledTimes(1);
    expect(t.audit.record).toHaveBeenCalledTimes(1);
  });

  it('refuses a second creator in a no-plan personal workspace', async () => {
    const t = build();
    const input = { account: 'guest@example.com', role: 'editor' } as const;

    await expect(
      t.service.add(WORKSPACE_ID, ACTOR, COOKIE, input),
    ).rejects.toMatchObject({
      response: {
        code: 'WORKSPACE_CREATOR_SEAT_LIMIT_REACHED',
        includedSeats: 1,
      },
    });
    expect(t.memberCreate).not.toHaveBeenCalled();
    expect(t.audit.record).not.toHaveBeenCalled();
  });
});

describe('WorkspaceMembersService.remove', () => {
  it('keeps project collaborators in the roster without workspace-wide access', async () => {
    const t = build();
    const current = {
      id: 'wm-existing',
      userId: 'guest-1',
      role: WorkspaceMemberRole.editor,
      status: WorkspaceMemberStatus.active,
      accessScope: WorkspaceMemberAccessScope.workspace,
    };
    const projected = {
      ...current,
      role: WorkspaceMemberRole.viewer,
      accessScope: WorkspaceMemberAccessScope.project_only,
    };
    t.prisma.workspaceMember.findFirst.mockResolvedValue(current);
    t.tx.projectMember.findFirst.mockResolvedValue({
      id: 'pm-1',
      status: ProjectMemberStatus.active,
    });
    t.tx.workspaceMember.update.mockResolvedValue(projected);

    await t.service.remove(WORKSPACE_ID, ACTOR, current.id);

    expect(t.tx.workspaceMember.update).toHaveBeenCalledWith({
      where: { id: current.id },
      data: {
        role: WorkspaceMemberRole.viewer,
        accessScope: WorkspaceMemberAccessScope.project_only,
      },
    });
    expect(t.notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `workspace.member.workspace_access_removed:${current.id}`,
      }),
      t.tx,
    );
    expect(t.tx.aiEventOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            action: 'role_changed',
            member: expect.objectContaining({
              role: WorkspaceMemberRole.viewer,
            }),
          }),
        }),
      }),
    );
    expect(t.realtime.revokeWorkspaceAccess).toHaveBeenCalledWith(
      WORKSPACE_ID,
      current.userId,
    );
    expect(t.docs.revokeUserFromDocuments).toHaveBeenCalledWith(
      [],
      current.userId,
    );
  });
});
