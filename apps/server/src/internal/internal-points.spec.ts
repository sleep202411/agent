import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { WalletLedgerEntryType } from '@prisma/client';
import { InternalPointsController } from './internal-points.controller';
import { CommunityGrantSchema } from './internal-points.dto';
import { InternalPointsService } from './internal-points.service';

describe('Java points bridge compatibility contract', () => {
  it('keeps POST /internal/points/migrate and /deduct machine endpoints', () => {
    expect(Reflect.getMetadata(PATH_METADATA, InternalPointsController)).toBe(
      'internal/points',
    );

    for (const [methodName, path] of [
      ['migrate', 'migrate'],
      ['deduct', 'deduct'],
      ['grantCommunity', 'community/grant'],
    ] as const) {
      const handler = InternalPointsController.prototype[methodName];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
        RequestMethod.POST,
      );
    }
  });

  it('preserves the Java response envelope for migrate and deduct', async () => {
    const points = {
      migrate: jest.fn().mockResolvedValue({ alreadyMigrated: false }),
      deduct: jest.fn().mockResolvedValue({ deducted: '12', deduped: false }),
    };
    const controller = new InternalPointsController(points as never);
    const migrate = { userId: 'java-user', balance: 50 };
    const deduct = {
      userId: 'java-user',
      amount: 12,
      idempotencyKey: 'java-job-1',
      reason: 'generation',
    };

    await expect(controller.migrate(migrate)).resolves.toEqual({
      code: 200,
      data: { alreadyMigrated: false },
    });
    await expect(controller.deduct(deduct)).resolves.toEqual({
      code: 200,
      data: { deducted: '12', deduped: false },
    });
    expect(points.migrate).toHaveBeenCalledWith(migrate);
    expect(points.deduct).toHaveBeenCalledWith(deduct);
  });

  it('keeps migration and deduction idempotency keys stable', async () => {
    const prisma = {
      pointsMigration: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      walletAccount: {
        upsert: jest.fn().mockResolvedValue({
          id: 'account-1',
          availableBalance: 0n,
        }),
      },
    };
    const walletLedger = {
      postEntry: jest
        .fn()
        .mockResolvedValueOnce({
          account: { availableBalance: 50n },
          deduped: false,
        })
        .mockResolvedValueOnce({
          account: { availableBalance: 38n },
          deduped: false,
        }),
    };
    const workspaces = {
      ensurePersonalWorkspace: jest
        .fn()
        .mockResolvedValue({ id: 'workspace-1' }),
    };
    const service = new InternalPointsService(
      prisma as never,
      walletLedger as never,
      workspaces as never,
    );

    await service.migrate({ userId: 'java-user', balance: 50 });
    await service.deduct({
      userId: 'java-user',
      amount: 12,
      idempotencyKey: 'java-job-1',
      reason: 'generation',
    });

    expect(walletLedger.postEntry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        entryType: WalletLedgerEntryType.credit,
        sourceType: 'points_migration',
        idempotencyKey: 'points_migration:java-user',
      }),
    );
    expect(walletLedger.postEntry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        entryType: WalletLedgerEntryType.debit,
        sourceType: 'java_points_deduct',
        idempotencyKey: 'points_deduct:java-job-1',
      }),
    );
  });

  it('credits community grants to the USER-owned community_point account', async () => {
    const prisma = {
      walletAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'community-account-1' }),
      },
    };
    const walletLedger = {
      postEntry: jest.fn().mockResolvedValue({
        account: { availableBalance: 2000n },
        entry: { amount: 2000n },
        deduped: false,
      }),
    };
    const service = new InternalPointsService(
      prisma as never,
      walletLedger as never,
      { ensurePersonalWorkspace: jest.fn() } as never,
    );

    const result = await service.grantCommunity({
      userId: '10086',
      amount: 2000,
      reason: 'promo_2026_cathy',
      idempotencyKey: 'promo_redeem:A8K3F2:10086',
      expiresAt: undefined,
    });

    // user-owned account, NOT a personal-workspace pot
    expect(prisma.walletAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          ownerType: 'user',
          ownerId: '10086',
          currency: 'community_point',
        }) as unknown,
      }),
    );
    // The server key MUST embed the userId — the ledger idempotency_key is
    // globally unique, so a bare caller key could dedupe across users.
    expect(walletLedger.postEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: WalletLedgerEntryType.credit,
        sourceType: 'java_community_grant',
        idempotencyKey: 'community_grant:10086:promo_redeem:A8K3F2:10086',
        workspaceId: null,
      }),
    );
    expect(result).toEqual({
      userId: '10086',
      granted: '2000',
      balance: '2000',
      deduped: false,
    });
  });

  it('rejects community grants above the per-call cap without touching the ledger', async () => {
    const prisma = { walletAccount: { upsert: jest.fn() } };
    const walletLedger = { postEntry: jest.fn() };
    const service = new InternalPointsService(
      prisma as never,
      walletLedger as never,
      { ensurePersonalWorkspace: jest.fn() } as never,
    );

    await expect(
      service.grantCommunity({
        userId: '10086',
        amount: 50_001,
        idempotencyKey: 'promo_redeem:A8K3F2:10086',
        reason: undefined,
        expiresAt: undefined,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AMOUNT_EXCEEDS_CAP',
      }) as unknown,
    });
    expect(prisma.walletAccount.upsert).not.toHaveBeenCalled();
    expect(walletLedger.postEntry).not.toHaveBeenCalled();
  });

  it('canonicalizes leading-zero user ids and bounds field lengths to the column budget', () => {
    const base = {
      amount: 2000,
      idempotencyKey: 'promo_redeem:A8K3F2:10086',
    };
    // "010086" would otherwise mint into a wallet no read path ever sees.
    expect(
      CommunityGrantSchema.parse({ ...base, userId: '010086' }).userId,
    ).toBe('10086');
    expect(
      CommunityGrantSchema.safeParse({ ...base, userId: 'creator-10086' })
        .success,
    ).toBe(false);
    // 181-char key would overflow VarChar columns after server-side prefixing.
    expect(
      CommunityGrantSchema.safeParse({
        ...base,
        userId: '10086',
        idempotencyKey: 'k'.repeat(181),
      }).success,
    ).toBe(false);
    expect(
      CommunityGrantSchema.safeParse({
        ...base,
        userId: '10086',
        idempotencyKey: 'k'.repeat(180),
      }).success,
    ).toBe(true);
    // ISO8601 with timezone parses to a Date; date-only and null are handled.
    expect(
      CommunityGrantSchema.parse({
        ...base,
        userId: '10086',
        expiresAt: '2026-11-30T00:00:00Z',
      }).expiresAt,
    ).toEqual(new Date('2026-11-30T00:00:00Z'));
    expect(
      CommunityGrantSchema.safeParse({
        ...base,
        userId: '10086',
        expiresAt: '2026-11-30',
      }).success,
    ).toBe(false);
    expect(
      CommunityGrantSchema.parse({ ...base, userId: '10086', expiresAt: null })
        .expiresAt,
    ).toBeUndefined();
  });
});
