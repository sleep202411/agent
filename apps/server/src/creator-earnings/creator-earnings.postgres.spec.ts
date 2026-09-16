import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../infra/db/db.module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  CreatorEarningsService,
  EarningsQuerySchema,
} from './creator-earnings.service';

const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.CREATOR_EARNINGS_POSTGRES_TEST === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
// The fixture deliberately uses a 30-second transaction; allow its completion
// and rollback before Jest tears down the database client.
jest.setTimeout(60000);
integration('Creator earnings read model (local PostgreSQL)', () => {
  let prisma: PrismaClient;
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !(
        (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
        (url.port === '55439' && url.pathname === '/task01')
      )
    )
      throw new Error(
        'Explicitly allowed named loopback test database required.',
      );
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        options: '-c timezone=UTC',
      }),
      transactionOptions: { timeout: 15000 },
    });
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('combines IP and story credits without exposing other wallets; filters and paginates deterministically', async () => {
    const rollback = new Error('ROLLBACK_TEST_FIXTURES');
    await expect(
      prisma.$transaction(
        async (tx) => {
          const user = `earnings-test-${randomUUID()}`;
          const foreignUser = `earnings-test-${randomUUID()}`;
          const project = randomUUID();
          const ipId = randomUUID();
          const account = await tx.walletAccount.create({
            data: {
              ownerType: 'user',
              ownerId: user,
              currency: 'community_point',
              balanceKind: 'withdrawable',
              availableBalance: 110n,
            },
          });
          const foreignAccount = await tx.walletAccount.create({
            data: {
              ownerType: 'user',
              ownerId: foreignUser,
              currency: 'community_point',
              balanceKind: 'withdrawable',
              availableBalance: 999n,
            },
          });
          const purchase = await tx.walletTransaction.create({
            data: {
              sourceType: 'story_content_purchase',
              idempotencyKey: randomUUID(),
              metadata: {
                projectId: project,
                title: { 'en-US': 'The tower', 'zh-CN': '钟楼' },
                communityPointPrice: 50,
              },
            },
          });
          const createdAt = new Date();
          async function credit(
            accountId: string,
            amount: bigint,
            reason: string,
            meta: object,
            status: 'posted' | 'voided' = 'posted',
          ) {
            const transaction = await tx.walletTransaction.create({
              data: {
                sourceType: reason,
                sourceId: purchase.id,
                status,
                idempotencyKey: randomUUID(),
                metadata: meta,
              },
            });
            return tx.walletLedgerEntry.create({
              data: {
                accountId,
                transactionId: transaction.id,
                entryType: 'credit',
                currency: 'community_point',
                balanceKind: 'withdrawable',
                amount,
                availableDelta: amount,
                heldDelta: 0n,
                availableBalanceAfter: amount,
                heldBalanceAfter: 0n,
                reason,
                createdAt,
              },
            });
          }
          const story = await credit(account.id, 50n, 'story_content_revenue', {
            projectId: project,
          });
          await credit(account.id, 10n, 'ip_revenue_share', { ipId });
          await credit(account.id, 50n, 'unrelated_credit', {});
          await credit(
            account.id,
            400n,
            'story_content_revenue',
            { projectId: project },
            'voided',
          );
          const foreign = await credit(
            foreignAccount.id,
            999n,
            'story_content_revenue',
            { projectId: project },
          );
          const service = new CreatorEarningsService(
            tx as unknown as PrismaService,
          );
          const all = await service.list(
            user,
            EarningsQuerySchema.parse({ locale: 'zh-CN' }),
          );
          expect(all.lifetimeEarned).toBe('60');
          expect(all.withdrawableBalance).toBe('110');
          expect(all.entries).toHaveLength(2);
          expect(all.works.map((w) => w.key).sort()).toEqual(
            [`ip:${ipId}`, `story:${project}`].sort(),
          );
          expect(all.entries.find((e) => e.id === story.id)).toMatchObject({
            amount: '50',
            sourceAmount: '50',
            contentTitle: '钟楼',
            orderNo: purchase.id,
          });
          expect(JSON.stringify(all)).not.toContain(foreign.id);
          const first = await service.list(
            user,
            EarningsQuerySchema.parse({ limit: 1 }),
          );
          const second = await service.list(
            user,
            EarningsQuerySchema.parse({ limit: 1, cursor: first.nextCursor }),
          );
          expect(
            new Set([...first.entries, ...second.entries].map((e) => e.id))
              .size,
          ).toBe(2);
          expect(second.nextCursor).toBeNull();
          const filtered = await service.list(
            user,
            EarningsQuerySchema.parse({ work: `story:${project}` }),
          );
          expect(filtered.entries.map((e) => e.id)).toEqual([story.id]);
          expect(filtered.lifetimeEarned).toBe('60');
          await expect(
            service.list(
              user,
              EarningsQuerySchema.parse({ cursor: foreign.id }),
            ),
          ).rejects.toThrow('Invalid earnings cursor');
          await tx.walletLedgerEntry.update({
            where: { id: story.id },
            data: { createdAt: new Date(Date.now() - 100 * 86400000) },
          });
          const recent = await service.list(
            user,
            EarningsQuerySchema.parse({ days: '30' }),
          );
          expect(recent.entries).toHaveLength(1);
          expect(recent.entries[0].kind).toBe('ip');
          const empty = await service.list(
            `missing-${randomUUID()}`,
            EarningsQuerySchema.parse({}),
          );
          expect(empty).toMatchObject({
            lifetimeEarned: '0',
            withdrawableBalance: '0',
            entries: [],
          });
          throw rollback;
        },
        { timeout: 30000 },
      ),
    ).rejects.toBe(rollback);
  });
});
