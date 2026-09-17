import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { WorkspaceInvitesService } from './workspace-invites.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { PlatformAuditLogService } from '../workspaces/audit-log.service';
const url = process.env.WORKSPACE_INVITE_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('workspace invitation role PostgreSQL regression', () => {
  let db: PrismaClient;
  beforeAll(() => {
    const target = new URL(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '55193' ||
      target.pathname !== '/ai_actor_review' ||
      target.search
    )
      throw Error('Use the dedicated local review database on port 55193');
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('concurrent acceptance upgrades once, retains membership identity and grants actual admin access', async () => {
    const userId = `invite-test-${randomUUID()}`;
    const workspace = await db.workspace.create({
      data: {
        name: 'Invite regression fixture',
        ownerUserId: 'test-owner',
        createdById: 'test-owner',
      },
    });
    const member = await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId, role: 'editor' },
    });
    const invite = await db.workspaceInvite.create({
      data: {
        workspaceId: workspace.id,
        role: 'admin',
        tokenHash: randomUUID(),
        invitedById: 'test-owner',
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const permissions = new WorkspacePermissionService(db as never);
    const service = new WorkspaceInvitesService(
      db as never,
      permissions,
      new PlatformAuditLogService(db as never),
      {
        resolveWorkspaceSeatPolicy: () => {
          throw Error('Existing editor should not purchase another seat');
        },
      } as never,
    );
    try {
      await expect(
        permissions.requireWorkspaceRole(userId, workspace.id, 'admin'),
      ).rejects.toThrow();
      expect(
        (await service.preview(invite, { userId })).existingAccess,
      ).toBeNull();
      await Promise.all([
        service.accept(invite, { userId }),
        service.accept(invite, { userId }),
      ]);
      const updated = await permissions.requireWorkspaceRole(
        userId,
        workspace.id,
        'admin',
      );
      expect(updated.id).toBe(member.id);
      expect(updated.role).toBe('admin');
      expect(updated.joinedAt).toEqual(member.joinedAt);
      expect(
        await db.workspaceMember.count({
          where: { workspaceId: workspace.id, userId },
        }),
      ).toBe(1);
      expect(
        (await service.preview(invite, { userId })).existingAccess?.scope,
      ).toBe('workspace');
      const lower = await db.workspaceInvite.update({
        where: { id: invite.id },
        data: { role: 'viewer' },
      });
      await service.accept(lower, { userId });
      expect(
        (
          await db.workspaceMember.findUniqueOrThrow({
            where: { id: member.id },
          })
        ).role,
      ).toBe('admin');
    } finally {
      await db.platformAuditLog.deleteMany({
        where: { workspaceId: workspace.id },
      });
      await db.aiEventOutbox.deleteMany({ where: { userId } });
      await db.workspaceInvite.deleteMany({
        where: { workspaceId: workspace.id },
      });
      await db.workspaceMember.deleteMany({
        where: { workspaceId: workspace.id },
      });
      await db.workspace.delete({ where: { id: workspace.id } });
    }
  });
});
