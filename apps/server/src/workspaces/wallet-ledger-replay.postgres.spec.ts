import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import {
  WalletLedgerService,
  type PostWalletEntryInput,
} from './wallet-ledger.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
jest.setTimeout(30000);
integration('Wallet ledger replay (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let ledger: WalletLedgerService;
  let ownerId: string;
  let accountId: string;
  let otherId: string;
  let key: string;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '55439' ||
      url.pathname !== '/task01'
    )
      throw new Error('Owned task01 fixture required');
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        options: '-c timezone=UTC',
      }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
    ledger = new WalletLedgerService(db as unknown as PrismaService);
  });
  beforeEach(async () => {
    ownerId = randomUUID();
    key = randomUUID();
    accountId = (
      await db.walletAccount.create({
        data: {
          ownerType: 'user',
          ownerId,
          currency: 'community_point',
          balanceKind: 'consumable',
        },
      })
    ).id;
    otherId = (
      await db.walletAccount.create({
        data: {
          ownerType: 'user',
          ownerId,
          currency: 'community_point',
          balanceKind: 'withdrawable',
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.walletTransaction.deleteMany({ where: { actorUserId: ownerId } });
    await db.walletAccount.deleteMany({ where: { ownerId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const input = (
    overrides: Partial<PostWalletEntryInput> = {},
  ): PostWalletEntryInput => ({
    accountId,
    entryType: 'credit',
    amount: 100n,
    availableDelta: 100n,
    heldDelta: 0n,
    sourceType: 'fixture',
    sourceId: 'fixture-source',
    actorUserId: ownerId,
    idempotencyKey: key,
    reason: 'fixture',
    creditGrant: { grantType: 'admin_adjustment' },
    ...overrides,
  });
  const snapshot = async () => ({
    accounts: await db.walletAccount.findMany({
      where: { ownerId },
      orderBy: { id: 'asc' },
    }),
    transactions: await db.walletTransaction.findMany({
      where: { actorUserId: ownerId },
      orderBy: { id: 'asc' },
    }),
    entries: await db.walletLedgerEntry.findMany({
      where: { account: { ownerId } },
      orderBy: { id: 'asc' },
    }),
    grants: await db.walletCreditGrant.findMany({
      where: { account: { ownerId } },
      orderBy: { id: 'asc' },
    }),
  });
  it('deduplicates concurrent same-account retries before writing a second credit', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => ledger.postEntry(input())),
    );
    expect(results.filter((r) => !r.deduped)).toHaveLength(1);
    const after = await snapshot();
    expect(after.transactions).toHaveLength(1);
    expect(after.grants).toHaveLength(1);
    expect(
      after.accounts.find((a) => a.id === accountId)?.availableBalance,
    ).toBe(100n);
  });
  it('rejects concurrent cross-account reuse instead of returning another account', async () => {
    const results = await Promise.allSettled([
      ledger.postEntry(input()),
      ledger.postEntry(input({ accountId: otherId, creditGrant: undefined })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failure.reason).toMatchObject({
      response: { code: 'WALLET_ENTRY_INTENT_CONFLICT' },
    });
    expect((await snapshot()).transactions).toHaveLength(1);
  });
  it.each([
    ['amount', { amount: 101n }],
    ['available delta', { availableDelta: 99n }],
    ['held delta', { heldDelta: 1n }],
    ['entry type', { entryType: 'adjustment' }],
    ['source type', { sourceType: 'other' }],
    ['source id', { sourceId: 'other' }],
    ['grant type', { creditGrant: { grantType: 'campaign_reward' } }],
  ] as [string, Partial<PostWalletEntryInput>][])(
    'rejects changed %s without modifying the original financial record',
    async (_, change) => {
      await ledger.postEntry(input());
      const before = await snapshot();
      await expect(ledger.postEntry(input(change))).rejects.toMatchObject({
        response: { code: 'WALLET_ENTRY_INTENT_CONFLICT' },
      });
      expect(await snapshot()).toEqual(before);
    },
  );
  it('preserves the original expiry when promotional callers recompute a retry proposal', async () => {
    const first = new Date('2100-01-01');
    await ledger.postEntry(
      input({
        creditGrant: { grantType: 'campaign_reward', expiresAt: first },
      }),
    );
    const before = await snapshot();
    const replay = await ledger.postEntry(
      input({
        creditGrant: {
          grantType: 'campaign_reward',
          expiresAt: new Date('2100-01-02'),
        },
      }),
    );
    expect(replay.deduped).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect(before.grants[0].expiresAt).toEqual(first);
  });
  it('retains a completed replay after the account is frozen', async () => {
    const original = await ledger.postEntry(input());
    await db.walletAccount.update({
      where: { id: accountId },
      data: { status: 'frozen' },
    });
    const replay = await ledger.postEntry(input());
    expect(replay.deduped).toBe(true);
    expect(replay.transaction.id).toBe(original.transaction.id);
  });
});
