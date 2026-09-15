import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../infra/db/db.module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { WalletLedgerService } from '../workspaces/wallet-ledger.service';
import {
  StoryCommunityAccessService,
  storyPurchaseKey,
} from './story-community-access.service';
import { compileStoryExperienceManifest } from './story-experience-manifest-compiler';
import { InteractiveFilmReleaseSchema } from '@repo/shared/interactive-film-runtime';
import type { AuthUser } from '../auth';

const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.STORY_COMMERCE_POSTGRES_TEST === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
integration('Story Community Points atomic purchase (local PostgreSQL)', () => {
  let prisma: PrismaClient;
  let service: StoryCommunityAccessService;
  let ledger: WalletLedgerService;
  const projectId = randomUUID();
  const buildId = randomUUID();
  const prefix = `story-pay-test-${randomUUID().slice(0, 8)}`;
  const buyer = { userId: `${prefix}-buyer` } as AuthUser;
  const creatorId = `${prefix}-creator`;
  const poor = { userId: `${prefix}-poor` } as AuthUser;
  const ids = [buyer.userId, creatorId, poor.userId];
  let buyerAccountId: string;
  const manifest = compileStoryExperienceManifest({
    release: InteractiveFilmReleaseSchema.parse({
      schemaVersion: 2,
      channel: 'production',
      gameId: projectId,
      releaseId: buildId,
      contentVersion: buildId,
      entryNodeId: 'start',
      defaultLocale: 'en-US',
      locales: ['en-US'],
      media: [],
      nodes: [
        {
          nodeId: 'start',
          presentation: { kind: 'decision' },
          exit: {
            kind: 'choice',
            decisionId: 'd1',
            prompt: { 'en-US': 'Choose' },
            choices: [
              {
                choiceId: 'c1',
                label: { 'en-US': 'Continue' },
                nextNodeId: 'paid',
              },
            ],
          },
        },
        {
          nodeId: 'paid',
          presentation: { kind: 'video', sequence: [], fit: 'cover' },
          communityPointPrice: 20,
          exit: { kind: 'auto', nextNodeId: 'end' },
        },
        {
          nodeId: 'end',
          presentation: { kind: 'video', sequence: [], fit: 'cover' },
          communityPointPrice: 30,
          exit: { kind: 'auto', nextNodeId: null },
        },
      ],
    }),
    experienceProfile: 'cinematic',
    metadata: { title: 'Purchase test' },
    mediaIdentities: [],
  }).manifest;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
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
    ledger = new WalletLedgerService(prisma as PrismaService);
    // Only release lookup is stubbed; wallet writes use the real transaction.
    // The service awaits this result and does not use Prisma's fluent relations.
    jest.spyOn(prisma.storyBuild, 'findFirst').mockImplementation((args) => {
      if (
        args?.where?.id === buildId &&
        args.where.storyProjectId === projectId
      )
        return Promise.resolve({
          id: buildId,
          storyProjectId: projectId,
          runtimeJson: manifest,
          assets: [],
          project: { createdByUserId: creatorId, sourceIpId: randomUUID() },
          experiencePublication: null,
          experienceDraftRelease: { status: 'pending' },
          gameReleaseChapters: [],
        }) as unknown as ReturnType<typeof prisma.storyBuild.findFirst>;
      return Promise.resolve(null) as ReturnType<
        typeof prisma.storyBuild.findFirst
      >;
    });
    service = new StoryCommunityAccessService(prisma as PrismaService, ledger);
    const accounts = await ledger.ensureDefaultAccounts('user', buyer.userId);
    buyerAccountId = accounts.find(
      (account) => account.balanceKind === 'consumable',
    )!.id;
    await ledger.postEntry({
      accountId: buyerAccountId,
      entryType: 'credit',
      amount: 100n,
      availableDelta: 100n,
      heldDelta: 0n,
      reason: 'test',
      sourceType: prefix,
      idempotencyKey: `${prefix}:fund`,
      actorUserId: buyer.userId,
      creditGrant: { grantType: 'purchase_topup' },
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (!prisma) return;
    const accounts = await prisma.walletAccount.findMany({
      where: { ownerType: 'user', ownerId: { in: ids } },
      select: { id: true },
    });
    const accountIds = accounts.map((account) => account.id);
    await prisma.walletCreditAllocation.deleteMany({
      where: { grant: { accountId: { in: accountIds } } },
    });
    await prisma.walletLedgerEntry.deleteMany({
      where: { accountId: { in: accountIds } },
    });
    await prisma.walletCreditGrant.deleteMany({
      where: { accountId: { in: accountIds } },
    });
    await prisma.walletTransaction.deleteMany({
      where: { actorUserId: { in: ids } },
    });
    await prisma.walletAccount.deleteMany({
      where: { id: { in: accountIds } },
    });
    await prisma.$disconnect();
  });
  it('parallel retries debit once and grant one permanent receipt', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.purchase(buyer, projectId, buildId, {
          key: 'node:paid',
          expectedPrice: 20,
        }),
      ),
    );
    expect(results.filter((result) => !result.alreadyOwned)).toHaveLength(1);
    expect(
      (
        await prisma.walletAccount.findUniqueOrThrow({
          where: { id: buyerAccountId },
        })
      ).availableBalance,
    ).toBe(80n);
    expect(
      await prisma.walletTransaction.count({
        where: {
          idempotencyKey: storyPurchaseKey(
            buyer.userId,
            projectId,
            'node:paid',
          ),
        },
      }),
    ).toBe(1);
    expect(
      await service.ownedKeys(buyer.userId, projectId, [
        {
          key: 'node:paid',
          communityPointPrice: 99,
          title: { 'en-US': 'Renamed' },
        },
      ]),
    ).toEqual(['node:paid']);
    const quote = await service.quote(buyer, projectId, buildId);
    expect(quote.ownedKeys).toContain('node:paid');
    expect(quote.balance).toBe('80');
  });
  it('credits the full price once to the story owner even when a source IP is linked', async () => {
    const account = await prisma.walletAccount.findFirst({
      where: {
        ownerId: creatorId,
        ownerType: 'user',
        balanceKind: 'withdrawable',
        currency: 'community_point',
      },
    });
    expect(account?.availableBalance).toBe(20n);
    expect(
      await prisma.walletLedgerEntry.count({
        where: { accountId: account!.id, reason: 'story_content_revenue' },
      }),
    ).toBe(1);
  });
  it('wrong price or insufficient funds leave no receipt and do not debit', async () => {
    await expect(
      service.purchase(buyer, projectId, buildId, {
        key: 'node:end',
        expectedPrice: 1,
      }),
    ).rejects.toThrow();
    await expect(
      service.purchase(poor, projectId, buildId, {
        key: 'node:end',
        expectedPrice: 30,
      }),
    ).rejects.toThrow();
    expect(
      (
        await prisma.walletAccount.findUniqueOrThrow({
          where: { id: buyerAccountId },
        })
      ).availableBalance,
    ).toBe(80n);
    expect(
      await prisma.walletTransaction.count({
        where: {
          idempotencyKey: storyPurchaseKey(poor.userId, projectId, 'node:end'),
        },
      }),
    ).toBe(0);
  });
  it('rolls back the buyer debit and entitlement if owner credit fails', async () => {
    const originalLedger = new WalletLedgerService(prisma as PrismaService);
    const failCredit = jest
      .spyOn(ledger, 'postEntryTx')
      .mockImplementation((tx, entry) => {
        if (entry.reason === 'story_content_revenue')
          throw new Error('Owner credit unavailable');
        return originalLedger.postEntryTx(tx, entry);
      });
    try {
      await expect(
        service.purchase(buyer, projectId, buildId, {
          key: 'node:end',
          expectedPrice: 30,
        }),
      ).rejects.toThrow('Owner credit unavailable');
      expect(
        (
          await prisma.walletAccount.findUniqueOrThrow({
            where: { id: buyerAccountId },
          })
        ).availableBalance,
      ).toBe(80n);
      expect(
        await prisma.walletTransaction.count({
          where: {
            idempotencyKey: storyPurchaseKey(
              buyer.userId,
              projectId,
              'node:end',
            ),
          },
        }),
      ).toBe(0);
    } finally {
      failCredit.mockRestore();
    }
  });
  it('creator preview is free and unpublished builds cannot be purchased', async () => {
    expect(
      await service.purchase(
        { userId: creatorId } as AuthUser,
        projectId,
        buildId,
        { key: 'node:end', expectedPrice: 30 },
      ),
    ).toEqual({ key: 'node:end', alreadyOwned: true });
    await expect(
      service.purchase(buyer, projectId, randomUUID(), {
        key: 'node:end',
        expectedPrice: 30,
      }),
    ).rejects.toThrow();
  });
});
