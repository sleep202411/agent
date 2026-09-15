import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { WorkspacesService } from './workspaces.service';
import { WalletLedgerService } from './wallet-ledger.service';
import { PlatformAuditLogService } from './audit-log.service';
import { WorkspacePermissionService } from './workspace-permission.service';

const url =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
(url ? describe : describe.skip)(
  'Workspace creation atomicity (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let userId: string;
    beforeAll(async () => {
      const target = new URL(url!);
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
    beforeEach(() => {
      userId = randomUUID();
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      const workspaces = await db.workspace.findMany({
        where: { createdById: userId },
        select: { id: true },
      });
      await db.walletAccount.deleteMany({
        where: {
          OR: [
            { ownerType: 'user', ownerId: userId },
            {
              ownerType: 'workspace',
              ownerId: { in: workspaces.map((w) => w.id) },
            },
          ],
        },
      });
      await db.workspace.deleteMany({ where: { createdById: userId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    function fixture() {
      const wallets = new WalletLedgerService(db as never);
      const audit = new PlatformAuditLogService(db as never);
      const service = new WorkspacesService(
        db as never,
        wallets,
        audit,
        new WorkspacePermissionService(db as never),
        {} as never,
        {} as never,
      );
      return { wallets, audit, service };
    }
    async function empty() {
      expect(await db.workspace.count({ where: { createdById: userId } })).toBe(
        0,
      );
      expect(await db.workspaceMember.count({ where: { userId } })).toBe(0);
      expect(
        await db.platformAuditLog.count({ where: { actorUserId: userId } }),
      ).toBe(0);
      expect(
        await db.walletAccount.count({
          where: { ownerType: 'user', ownerId: userId },
        }),
      ).toBe(0);
    }
    it('rolls back workspace, membership and wallet when creation audit fails, then allows retry', async () => {
      const { service, audit } = fixture();
      const spy = jest
        .spyOn(audit, 'record')
        .mockRejectedValueOnce(new Error('audit unavailable'));
      await expect(
        service.createWorkspace({ userId } as never, { name: 'Atomic' }),
      ).rejects.toThrow('audit unavailable');
      await empty();
      const rejectedWorkspaceId = spy.mock.calls[0][0].workspaceId!;
      expect(
        await db.walletAccount.count({
          where: { ownerType: 'workspace', ownerId: rejectedWorkspaceId },
        }),
      ).toBe(0);
      spy.mockRestore();
      const result = await service.createWorkspace({ userId } as never, {
        name: 'Atomic',
      });
      expect(
        await db.walletAccount.count({
          where: { ownerType: 'workspace', ownerId: result.workspace.id },
        }),
      ).toBe(1);
      expect(
        await db.platformAuditLog.count({ where: { actorUserId: userId } }),
      ).toBe(1);
    });
    it('rolls back creation when wallet initialization fails', async () => {
      const { service, wallets } = fixture();
      jest
        .spyOn(wallets, 'ensureDefaultAccounts')
        .mockRejectedValueOnce(new Error('wallet unavailable'));
      await expect(
        service.createWorkspace({ userId } as never, { name: 'Atomic' }),
      ).rejects.toThrow('wallet unavailable');
      await empty();
    });
    it('rolls back default bootstrap including user wallets after later workspace-wallet failure', async () => {
      const { service, wallets } = fixture();
      const recorder = new WalletLedgerService(db as never);
      jest
        .spyOn(wallets, 'ensureDefaultAccounts')
        .mockImplementation((type, id, tx) => {
          if (type === 'workspace')
            return Promise.reject(new Error('workspace wallet unavailable'));
          return recorder.ensureDefaultAccounts(type, id, tx);
        });
      await expect(
        service.ensureDefaultWorkspace({ userId } as never),
      ).rejects.toThrow('workspace wallet unavailable');
      await empty();
    });
    it('reuses one default workspace and its wallets across concurrent bootstrap retries', async () => {
      const { service } = fixture();
      const [a, b] = await Promise.all([
        service.ensureDefaultWorkspace({ userId } as never),
        service.ensureDefaultWorkspace({ userId } as never),
      ]);
      expect(a.id).toBe(b.id);
      expect(
        await db.workspaceMember.count({
          where: { workspaceId: a.id, userId },
        }),
      ).toBe(1);
      expect(
        await db.walletAccount.count({
          where: { ownerType: 'user', ownerId: userId },
        }),
      ).toBe(2);
      expect(
        await db.walletAccount.count({
          where: { ownerType: 'workspace', ownerId: a.id },
        }),
      ).toBe(1);
    });
  },
);
