import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { VoucherService } from './voucher.service';
import { WalletLedgerService } from '../workspaces';
import { walletWorkspaceChannel } from '../infra/realtime/realtime-groups';
const url =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
(url ? describe : describe.skip)(
  'Voucher claim recovery (owned PostgreSQL)',
  () => {
    let db: PrismaClient,
      userId: string,
      workspaceId: string,
      voucherId: string,
      code: string;
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
    beforeEach(async () => {
      userId = randomUUID();
      code = randomUUID().toUpperCase();
      workspaceId = (
        await db.workspace.create({
          data: {
            name: 'Voucher fixture',
            createdById: userId,
            ownerUserId: userId,
            defaultForUserId: userId,
          },
        })
      ).id;
      voucherId = (
        await db.voucher.create({
          data: { code, createdById: userId, computeCreditAmount: 123 },
        })
      ).id;
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await db.aiEventOutbox.deleteMany({ where: { userId } });
      await db.realtimeSequenceCursor.deleteMany({
        where: { channel: walletWorkspaceChannel(workspaceId) },
      });
      await db.walletTransaction.deleteMany({ where: { actorUserId: userId } });
      await db.walletAccount.deleteMany({ where: { ownerId: workspaceId } });
      await db.voucher.deleteMany({ where: { id: voucherId } });
      await db.workspace.deleteMany({ where: { id: workspaceId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    function fixture() {
      const wallet = new WalletLedgerService(db as never);
      return { wallet, service: new VoucherService(db as never, wallet) };
    }
    it.each(['void', 'expired', 'other-owner'] as const)(
      'does not credit after %s wins the voucher lock',
      async (change) => {
        const { service } = fixture();
        let unlock!: () => void, ready!: (tx: Prisma.TransactionClient) => void;
        const held = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        const entered = new Promise<Prisma.TransactionClient>((resolve) => {
          ready = resolve;
        });
        const blocker = db.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM vouchers WHERE id=${voucherId}::uuid FOR UPDATE`;
            ready(tx);
            await held;
          },
          { timeout: 10000 },
        );
        const tx = await entered;
        const pending = service.redeemVoucher({ userId }, { code });
        const rejected = expect(pending).rejects.toMatchObject({
          response: {
            code:
              change === 'void'
                ? 'VOUCHER_VOID'
                : change === 'expired'
                  ? 'VOUCHER_EXPIRED'
                  : 'VOUCHER_ALREADY_REDEEMED',
          },
        });
        try {
          let waiting = false;
          for (let i = 0; i < 200; i++) {
            const rows = await db.$queryRaw<
              Array<{ count: bigint }>
            >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%vouchers%' AND query LIKE '%FOR UPDATE%'`;
            if (Number(rows[0].count) > 0) {
              waiting = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(waiting).toBe(true);
          await tx.voucher.update({
            where: { id: voucherId },
            data:
              change === 'void'
                ? { status: 'void' }
                : change === 'expired'
                  ? { expiresAt: new Date('2000-01-01T00:00:00Z') }
                  : {
                      status: 'redeemed',
                      redeemedByUserId: randomUUID(),
                      redeemedWorkspaceId: workspaceId,
                      redeemedAt: new Date(),
                    },
          });
        } finally {
          unlock();
          await blocker;
        }
        await rejected;
        expect(
          await db.walletAccount.count({ where: { ownerId: workspaceId } }),
        ).toBe(0);
        expect(
          await db.walletTransaction.count({ where: { actorUserId: userId } }),
        ).toBe(0);
      },
    );
    it('recovers the accepted destination after credit failure and removal of the current default', async () => {
      const { service, wallet } = fixture();
      jest
        .spyOn(wallet, 'postEntry')
        .mockRejectedValueOnce(new Error('credit unavailable'));
      await expect(service.redeemVoucher({ userId }, { code })).rejects.toThrow(
        'credit unavailable',
      );
      await db.workspace.update({
        where: { id: workspaceId },
        data: { defaultForUserId: null },
      });
      const result = await service.redeemVoucher({ userId }, { code });
      expect(result.granted).toMatchObject({ amount: '123', workspaceId });
      const replay = await service.redeemVoucher({ userId }, { code });
      expect(replay.alreadyRedeemed).toBe(true);
      expect(
        await db.walletTransaction.count({ where: { actorUserId: userId } }),
      ).toBe(1);
    });
    it('credits once for simultaneous calls by the same redeemer', async () => {
      const { service } = fixture();
      const results = await Promise.all([
        service.redeemVoucher({ userId }, { code }),
        service.redeemVoucher({ userId }, { code }),
      ]);
      expect(results.filter((r) => r.alreadyRedeemed)).toHaveLength(1);
      expect(
        await db.walletTransaction.count({ where: { actorUserId: userId } }),
      ).toBe(1);
    });
  },
);
