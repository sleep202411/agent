import {
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
function build(input: { activeSeats: number }) {
  const memberCreate = jest.fn().mockResolvedValue({
    id: 'wm-new',
    userId: 'guest-1',
    role: WorkspaceMemberRole.editor,
    status: WorkspaceMemberStatus.active,
    joinedAt: new Date('2026-07-26T00:00:00.000Z'),
  });
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([{ next_seq: 2n }]),
    entitlementGrant: { findMany: jest.fn().mockResolvedValue([]) },
    billingMembershipPlan: { findMany: jest.fn().mockResolvedValue([]) },
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ type: WorkspaceType.personal }),
    },
    workspaceMember: {
      count: jest.fn().mockResolvedValue(input.activeSeats),
      create: memberCreate,
    },
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
  return {
    tx,
    prisma,
    notifications,
    audit,
    memberCreate,
    service: new WorkspaceMembersService(
      prisma as never,
      notifications as never,
      users as never,
      permissions as never,
      audit as never,
      { revokeUserFromDocuments: jest.fn() } as never,
      new EntitlementService({} as never),
      { revokeWorkspaceAccess: jest.fn() } as never,
    ),
  };
}

describe('WorkspaceMembersService.add on a personal workspace', () => {
  const input = { account: 'guest@example.com', role: 'editor' } as const;

  it('adds a collaborator while seats remain', async () => {
    const t = build({ activeSeats: 1 });

    const member = await t.service.add(WORKSPACE_ID, ACTOR, COOKIE, input);

    expect(member).toMatchObject({ memberId: 'wm-new', userId: 'guest-1' });
    expect(t.memberCreate).toHaveBeenCalledTimes(1);
    const calls = t.memberCreate.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(calls[0][0].data).toMatchObject({
      workspaceId: WORKSPACE_ID,
      userId: 'guest-1',
      role: WorkspaceMemberRole.editor,
      seatAssigned: true,
    });
    expect(t.notifications.send).toHaveBeenCalledTimes(1);
    expect(t.audit.record).toHaveBeenCalledTimes(1);
  });

  it('is refused by the seat gate once the 5 seats are full', async () => {
    const t = build({ activeSeats: 5 });

    await expect(
      t.service.add(WORKSPACE_ID, ACTOR, COOKIE, input),
    ).rejects.toMatchObject({
      response: { code: 'WORKSPACE_SEAT_LIMIT_REACHED', includedSeats: 5 },
    });
    expect(t.memberCreate).not.toHaveBeenCalled();
    expect(t.audit.record).not.toHaveBeenCalled();
  });
});
