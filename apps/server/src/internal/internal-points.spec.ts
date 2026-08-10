import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { WalletLedgerEntryType } from '@prisma/client';
import { InternalPointsController } from './internal-points.controller';
import { InternalPointsService } from './internal-points.service';

describe('Java points bridge compatibility contract', () => {
  it('keeps POST /internal/points/migrate and /deduct machine endpoints', () => {
    expect(Reflect.getMetadata(PATH_METADATA, InternalPointsController)).toBe(
      'internal/points',
    );

    for (const [methodName, path] of [
      ['migrate', 'migrate'],
      ['deduct', 'deduct'],
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
});
