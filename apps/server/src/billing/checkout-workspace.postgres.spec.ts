import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  COMPUTE_POINT_EXPLICIT_ADMIN_PRICING,
  COMPUTE_POINTS_PER_USD_CENT,
} from '@repo/shared';
import { CURRENT_CELL } from '../common/region';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { BillingService } from './billing.service';
const url =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
(url ? describe : describe.skip)(
  'Checkout workspace admission (owned PostgreSQL)',
  () => {
    let db: PrismaClient, workspaceId: string, userId: string;
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
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
      userId = randomUUID();
      await db.workspace.create({
        data: {
          id: workspaceId,
          ownerUserId: userId,
          createdById: userId,
          name: 'Checkout fixture',
        },
      });
      await db.workspaceMember.create({
        data: { workspaceId, userId, role: 'owner', status: 'active' },
      });
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await db.workspace.delete({ where: { id: workspaceId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    function fixture() {
      const provider = CURRENT_CELL === 'cn' ? 'wechat_pay' : 'airwallex';
      const pay = jest
        .fn()
        .mockRejectedValue(new Error('No live provider call permitted'));
      const service = new BillingService(
        db as never,
        {
          defaultProviderForRuntime: () => provider,
          get: () => ({
            capabilities: { paymentIntent: true },
            createPaymentIntent: pay,
          }),
        } as never,
        new WorkspacePermissionService(db as never),
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      return { service, pay };
    }
    for (const kind of ['checkout', 'topup', 'custom'] as const) {
      it.each(['role', 'deleted'] as const)(
        `${kind} rejects %s changes during workspace admission`,
        async (change) => {
          const { service, pay } = fixture();
          const priceId = randomUUID();
          jest.spyOn(db.billingPrice, 'findFirst').mockResolvedValue({
            id: priceId,
            itemId: randomUUID(),
            amountMinor: 100n,
            interval: 'one_time',
            currency: CURRENT_CELL === 'cn' ? 'CNY' : 'USD',
            subjectType: kind === 'checkout' ? 'workspace' : 'user',
            grantsWalletCurrency: 'compute_point',
            grantsWalletBalanceKind: 'consumable',
            grantsWalletAmount: 100n * BigInt(COMPUTE_POINTS_PER_USD_CENT),
            metadata: {
              topupKind: 'compute_point',
              rateMode: COMPUTE_POINT_EXPLICIT_ADMIN_PRICING,
            },
            item: {
              productType:
                kind === 'checkout' ? 'membership_plan' : 'compute_point_pack',
              name: 'Fixture',
            },
            providerBindings: [],
          } as never);
          let unlock!: () => void,
            ready!: (tx: Prisma.TransactionClient) => void;
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
          const input = {
            workspaceId,
            priceId,
            idempotencyKey: randomUUID(),
            quantity: 1,
            currency: 'compute_point' as const,
            amountDollars: 10,
            successUrl: 'https://studio.fizzdragon.com/en-US?payment=success',
            backUrl: 'https://studio.fizzdragon.com/en-US?payment=cancelled',
          };
          const pending =
            kind === 'checkout'
              ? service.createCheckout({ userId }, input)
              : kind === 'topup'
                ? service.createComputePointTopup({ userId }, input, 'US')
                : service.createCustomRecharge({ userId }, input, 'US');
          const assertion = expect(pending).rejects.toMatchObject({
            status: 403,
          });
          try {
            let waiting = false;
            for (let i = 0; i < 200; i++) {
              const rows = await db.$queryRaw<
                Array<{ count: bigint }>
              >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR SHARE%'`;
              if (Number(rows[0].count) > 0) {
                waiting = true;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            expect(waiting).toBe(true);
            if (change === 'role')
              await tx.workspaceMember.updateMany({
                where: { workspaceId, userId },
                data: { role: 'viewer' },
              });
            else
              await tx.workspace.update({
                where: { id: workspaceId },
                data: { deletedAt: new Date() },
              });
          } finally {
            unlock();
            await blocker;
          }
          await assertion;
          expect(await db.billingOrder.count({ where: { userId } })).toBe(0);
          expect(pay).not.toHaveBeenCalled();
        },
      );
    }
    it('admits a current workspace owner without creating financial records', async () => {
      const { service } = fixture();
      const gate = service as unknown as {
        lockCheckoutWorkspace(
          tx: Prisma.TransactionClient,
          user: { userId: string },
          subject: { subjectType: 'workspace'; subjectId: string },
        ): Promise<void>;
      };
      await db.$transaction((tx) =>
        gate.lockCheckoutWorkspace(
          tx,
          { userId },
          { subjectType: 'workspace', subjectId: workspaceId },
        ),
      );
      expect(await db.billingOrder.count({ where: { userId } })).toBe(0);
    });
  },
);
