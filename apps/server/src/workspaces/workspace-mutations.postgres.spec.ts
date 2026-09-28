import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { WorkspacesService } from './workspaces.service';
import { WorkspacePermissionService } from './workspace-permission.service';
import { PlatformAuditLogService } from './audit-log.service';
const url =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
(url ? describe : describe.skip)(
  'Workspace mutation recovery (owned PostgreSQL)',
  () => {
    let db: PrismaClient,
      workspaceId: string,
      projectId: string,
      userId: string;
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        target.port !== '55439' ||
        target.pathname !== '/task01'
      )
        throw new Error('Owned fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: url,
          options: '-c timezone=UTC',
        }),
      });
      await db.$connect();
    });
    beforeEach(async () => {
      workspaceId = randomUUID();
      projectId = randomUUID();
      userId = randomUUID();
      await db.workspace.create({
        data: {
          id: workspaceId,
          name: 'Original',
          ownerUserId: userId,
          createdById: userId,
        },
      });
      await db.workspaceMember.create({
        data: { workspaceId, userId, role: 'owner', status: 'active' },
      });
      await db.platformProject.create({
        data: {
          id: projectId,
          workspaceId,
          name: 'Original',
          createdById: userId,
        },
      });
    });
    afterEach(async () => {
      await db.aiEventOutbox.deleteMany({ where: { userId } });
      await db.walletAccount.deleteMany({
        where: { ownerType: 'workspace', ownerId: workspaceId },
      });
      await db.workspace.delete({ where: { id: workspaceId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    function fixture() {
      const audit = new PlatformAuditLogService(db as never);
      const instance = new WorkspacesService(
        db as never,
        { expireLapsedGrants: () => Promise.resolve({ expired: 0n }) } as never,
        audit,
        new WorkspacePermissionService(db as never),
        { revokeWorkspaceAccess: () => Promise.resolve() } as never,
        {} as never,
      );
      return { audit, instance };
    }
    const actions = [
      'workspace',
      'create',
      'project',
      'archive',
      'delete',
    ] as const;
    function run(
      instance: WorkspacesService,
      action: (typeof actions)[number],
    ) {
      const user = { userId } as never;
      if (action === 'delete')
        return instance.deleteWorkspace(user, workspaceId, {});
      if (action === 'archive')
        return instance.archiveProject(user, projectId, {});
      if (action === 'workspace')
        return instance.updateWorkspace(user, workspaceId, { name: 'Changed' });
      if (action === 'project')
        return instance.updateProject(user, projectId, { name: 'Changed' });
      return instance.createProject(user, workspaceId, {
        name: 'Changed',
        initialSectionTitle: 'First',
        projectType: 'general',
        visibility: 'private',
      });
    }
    async function expectOriginal() {
      expect(
        (await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }))
          .deletedAt,
      ).toBeNull();
      expect(
        (
          await db.platformProject.findUniqueOrThrow({
            where: { id: projectId },
          })
        ).status,
      ).toBe('active');
      expect(await db.aiEventOutbox.count({ where: { userId } })).toBe(0);
      expect(
        (await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }))
          .name,
      ).toBe('Original');
      expect(
        (
          await db.platformProject.findUniqueOrThrow({
            where: { id: projectId },
          })
        ).name,
      ).toBe('Original');
      expect(await db.platformProject.count({ where: { workspaceId } })).toBe(
        1,
      );
      expect(await db.platformAuditLog.count({ where: { workspaceId } })).toBe(
        0,
      );
    }
    it.each(actions)(
      '%s rolls back when audit recording fails',
      async (action) => {
        const { instance, audit } = fixture();
        jest
          .spyOn(audit, 'record')
          .mockRejectedValue(new Error('audit unavailable'));
        await expect(run(instance, action)).rejects.toThrow(
          'audit unavailable',
        );
        await expectOriginal();
      },
    );
    it.each(actions)(
      '%s writes its audit with the successful change',
      async (action) => {
        const { instance } = fixture();
        await run(instance, action);
        expect(
          await db.platformAuditLog.count({ where: { workspaceId } }),
        ).toBe(1);
      },
    );
    it.each(actions)(
      '%s rejects permission withdrawn during its lock wait',
      async (action) => {
        const { instance } = fixture();
        let unlock!: () => void, ready!: (tx: Prisma.TransactionClient) => void;
        const held = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        const entered = new Promise<Prisma.TransactionClient>((resolve) => {
          ready = resolve;
        });
        const blocker = db.$transaction(
          async (tx) => {
            if (action === 'project' || action === 'archive')
              await tx.$queryRaw`SELECT id FROM platform_projects WHERE id = ${projectId}::uuid FOR UPDATE`;
            else
              await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
            ready(tx);
            await held;
          },
          { timeout: 10000 },
        );
        const tx = await entered;
        const pending = run(instance, action);
        const assertion = expect(pending).rejects.toMatchObject({
          status: 403,
        });
        try {
          let waiting = false;
          for (let i = 0; i < 200; i++) {
            const rows = await db.$queryRaw<
              Array<{ count: bigint }>
            >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`;
            if (Number(rows[0].count) > 0) {
              waiting = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(waiting).toBe(true);
          await tx.workspaceMember.updateMany({
            where: { workspaceId, userId },
            data: { role: 'viewer' },
          });
        } finally {
          unlock();
          await blocker;
        }
        await assertion;
        await expectOriginal();
      },
    );

    it.each(actions)(
      '%s rolls back if permission is withdrawn before commit',
      async (action) => {
        const { instance, audit } = fixture();
        const recorder = new PlatformAuditLogService(db as never);
        jest.spyOn(audit, 'record').mockImplementation(async (input, tx) => {
          await recorder.record(input, tx);
          await db.workspaceMember.updateMany({
            where: { workspaceId, userId },
            data: { role: 'viewer' },
          });
        });
        await expect(run(instance, action)).rejects.toMatchObject({
          status: 403,
        });
        await expectOriginal();
      },
    );

    it.each(['deleted', 'suspended'] as const)(
      'denies direct project membership under a %s workspace',
      async (state) => {
        await db.projectMember.create({
          data: { projectId, userId, role: 'owner', grantedById: userId },
        });
        const project = await db.platformProject.findUniqueOrThrow({
          where: { id: projectId },
        });
        await db.workspace.update({
          where: { id: workspaceId },
          data:
            state === 'deleted'
              ? { deletedAt: new Date() }
              : { status: 'suspended' },
        });
        const permissions = new WorkspacePermissionService(db as never);
        await expect(
          permissions.requireProjectRole(userId, projectId, 'viewer'),
        ).rejects.toMatchObject({ status: 404 });
        expect(
          await permissions.resolveEffectiveProjectRole(userId, project),
        ).toBeNull();
      },
    );
    it.each([
      ['viewer', 'owner', 'owner'],
      ['admin', 'viewer', 'admin'],
      ['viewer', 'billing', 'viewer'],
    ] as const)(
      'matches direct %s plus workspace %s to effective %s',
      async (direct, inherited, expected) => {
        await db.projectMember.create({
          data: { projectId, userId, role: direct, grantedById: userId },
        });
        await db.workspaceMember.updateMany({
          where: { workspaceId, userId },
          data: { role: inherited },
        });
        const project = await db.platformProject.findUniqueOrThrow({
          where: { id: projectId },
        });
        const permissions = new WorkspacePermissionService(db as never);
        expect(
          await permissions.resolveEffectiveProjectRole(userId, project),
        ).toBe(expected);
        await expect(
          permissions.requireProjectRole(userId, projectId, expected),
        ).resolves.toMatchObject({ id: projectId });
      },
    );

    it.each(['audit', 'version'] as const)(
      'retains the default project after an archive %s failure',
      async (failure) => {
        await db.workspace.update({
          where: { id: workspaceId },
          data: { defaultProjectId: projectId },
        });
        const { instance, audit } = fixture();
        if (failure === 'audit')
          jest
            .spyOn(audit, 'record')
            .mockRejectedValue(new Error('audit unavailable'));
        await expect(
          instance.archiveProject(
            { userId } as never,
            projectId,
            failure === 'version' ? { expectedVersion: 999 } : {},
          ),
        ).rejects.toBeInstanceOf(Error);
        expect(
          (await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }))
            .defaultProjectId,
        ).toBe(projectId);
        await expectOriginal();
      },
    );

    it.each(['default', 'funded'] as const)(
      'rejects deletion when the workspace becomes %s during admission',
      async (change) => {
        const { instance } = fixture();
        let unlock!: () => void, ready!: (tx: Prisma.TransactionClient) => void;
        const held = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        const entered = new Promise<Prisma.TransactionClient>((resolve) => {
          ready = resolve;
        });
        const blocker = db.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
            ready(tx);
            await held;
          },
          { timeout: 10000 },
        );
        const tx = await entered;
        const pending = instance.deleteWorkspace(
          { userId } as never,
          workspaceId,
          {},
        );
        const assertion = expect(pending).rejects.toMatchObject({
          response: {
            code:
              change === 'default'
                ? 'DEFAULT_WORKSPACE_CANNOT_BE_DELETED'
                : 'WORKSPACE_NOT_EMPTY',
          },
        });
        try {
          let waiting = false;
          for (let i = 0; i < 200; i++) {
            const rows = await db.$queryRaw<
              Array<{ count: bigint }>
            >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`;
            if (Number(rows[0].count) > 0) {
              waiting = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(waiting).toBe(true);
          if (change === 'default')
            await tx.workspace.update({
              where: { id: workspaceId },
              data: { defaultForUserId: userId },
            });
          else
            await tx.walletAccount.create({
              data: {
                ownerType: 'workspace',
                ownerId: workspaceId,
                currency: 'compute_point',
                balanceKind: 'consumable',
                availableBalance: 20n,
              },
            });
        } finally {
          unlock();
          await blocker;
        }
        await assertion;
        await expectOriginal();
      },
    );
  },
);
