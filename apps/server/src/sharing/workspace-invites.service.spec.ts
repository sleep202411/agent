import {
  WorkspaceInviteStatus,
  WorkspaceMemberRole,
  WorkspaceType,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { WorkspaceInvitesService } from './workspace-invites.service';

const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const ACTOR = { userId: 'owner-1' } as AuthUser;

function build() {
  const inviteCreate = jest.fn().mockResolvedValue({
    id: 'invite-1',
    role: WorkspaceMemberRole.editor,
    status: WorkspaceInviteStatus.pending,
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  const prisma = {
    workspace: {
      // The row still carries `type` even though create() stopped reading it —
      // that is exactly what this fixture pins.
      findFirst: jest.fn().mockResolvedValue({
        id: WORKSPACE_ID,
        name: 'My workspace',
        type: WorkspaceType.personal,
      }),
    },
    workspaceInvite: { create: inviteCreate },
  };
  const permissions = { requireWorkspaceRole: jest.fn() };
  const audit = { record: jest.fn() };
  return {
    prisma,
    permissions,
    audit,
    inviteCreate,
    service: new WorkspaceInvitesService(
      prisma as never,
      permissions as never,
      audit as never,
      {} as never,
    ),
  };
}

describe('WorkspaceInvitesService.create', () => {
  it('mints a link for a personal workspace', async () => {
    const t = build();

    const result = await t.service.create(WORKSPACE_ID, ACTOR, {
      role: 'editor',
      expiresInDays: 7,
    });

    expect(result.inviteId).toBe('invite-1');
    // The raw token is returned exactly once, here — never persisted.
    expect(result.token).toEqual(expect.any(String));
    expect(t.inviteCreate).toHaveBeenCalledTimes(1);
    const calls = t.inviteCreate.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(calls[0][0].data).toMatchObject({
      workspaceId: WORKSPACE_ID,
      role: WorkspaceMemberRole.editor,
    });
    expect(t.audit.record).toHaveBeenCalledTimes(1);
  });
});

/**
 * REGRESSION PINS, not new-behaviour coverage: these gates pass with the
 * personal-workspace refusal still in place, so they prove nothing about it.
 * They are here because dropping that refusal deleted the only other read of the
 * workspace row in `create` — these pin that the row is still fetched and the
 * role still checked.
 */
describe('WorkspaceInvitesService.create — gates the change did not touch', () => {
  it('404s a workspace that does not exist', async () => {
    const t = build();
    t.prisma.workspace.findFirst.mockResolvedValue(null);

    await expect(
      t.service.create(WORKSPACE_ID, ACTOR, {
        role: 'editor',
        expiresInDays: 7,
      }),
    ).rejects.toMatchObject({ response: { code: 'WORKSPACE_NOT_FOUND' } });
    expect(t.inviteCreate).not.toHaveBeenCalled();
  });

  it('still requires admin on the workspace', async () => {
    const t = build();
    t.permissions.requireWorkspaceRole.mockRejectedValue(
      new Error('WORKSPACE_PERMISSION_DENIED'),
    );

    await expect(
      t.service.create(WORKSPACE_ID, ACTOR, {
        role: 'editor',
        expiresInDays: 7,
      }),
    ).rejects.toThrow('WORKSPACE_PERMISSION_DENIED');
    expect(t.inviteCreate).not.toHaveBeenCalled();
  });
});
