import { WithdrawalProofsService } from './withdrawal-proofs.service';
import { StorageProviderRegistry } from '../infra/storage/storage-provider-registry.service';
import { NotificationService } from '../notification/notification.service';
import {
  WithdrawalAdminService,
  WITHDRAWAL_MANAGE_PERMISSION,
} from './withdrawal-admin.service';
import type { AdminActor } from '../admin-auth';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CreatorWithdrawalsService } from './creator-withdrawals.service';
import { PrismaService } from '../infra/db/db.module';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { decryptRecipient } from './recipient-encryption';
import { CrewEarningsService } from '../crews/earnings/earnings.service';

const url = process.env.WITHDRAWAL_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Creator withdrawal reservations (local PostgreSQL)',
  () => {
    let db: PrismaClient;
    let service: CreatorWithdrawalsService;
    const users: string[] = [];
    const crews: string[] = [];
    const previousKey = process.env.CREATOR_PAYOUT_DETAILS_KEY;
    const recipient = {
      fullName: 'Fixture Creator',
      accountNumber: 'TEST-12345678',
      address: 'Fixture address',
      swift: 'DBSSSGSG',
      branchAddress: 'Fixture branch',
    };
    beforeAll(() => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55441' ||
        !['/withdrawal_test', '/audit_migrations_20261005'].includes(
          target.pathname,
        )
      )
        throw new Error('Dedicated loopback withdrawal fixture required');
      process.env.CREATOR_PAYOUT_DETAILS_KEY = 'ab'.repeat(32);
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      service = new CreatorWithdrawalsService(db as PrismaService);
    });
    afterAll(async () => {
      if (previousKey === undefined)
        delete process.env.CREATOR_PAYOUT_DETAILS_KEY;
      else process.env.CREATOR_PAYOUT_DETAILS_KEY = previousKey;
      if (db) {
        await db.$transaction(async (tx) => {
          // Only remove this suite's rows, on the explicitly allowlisted local database.
          // Keep historical append-only guards active for every test operation.
          await tx.$executeRawUnsafe(
            'SET LOCAL session_replication_role = replica',
          );
          await tx.notificationOutbox.deleteMany({
            where: { userId: { in: users } },
          });
          await tx.notification.deleteMany({
            where: { userId: { in: users } },
          });
          await tx.creatorWithdrawalEvent.deleteMany({
            where: { withdrawal: { userId: { in: users } } },
          });
          await tx.crewPayoutEvent.deleteMany({
            where: { crewId: { in: crews } },
          });
          await tx.crewPayoutAllocation.deleteMany({
            where: { crewId: { in: crews } },
          });
          await tx.crewPayout.deleteMany({ where: { crewId: { in: crews } } });
          await tx.$executeRaw`DELETE FROM creator_withdrawal_proofs WHERE withdrawal_id IN (SELECT id FROM creator_withdrawals WHERE user_id = ANY(${users}::text[]))`;
          await tx.creatorWithdrawal.deleteMany({
            where: { userId: { in: users } },
          });
          await tx.creatorPayoutAccount.deleteMany({
            where: { userId: { in: users } },
          });
          await tx.crewEarningEvent.deleteMany({
            where: { crewId: { in: crews } },
          });
          await tx.crewEarningEntry.deleteMany({
            where: { crewId: { in: crews } },
          });
          await tx.crewTask.deleteMany({ where: { crewId: { in: crews } } });
          await tx.crew.deleteMany({ where: { id: { in: crews } } });
        });
        await db.$disconnect();
      }
    });
    async function seed(
      amount = 3000n,
      userId = `withdrawal-${randomUUID()}`,
      currency = 'USD',
      status: 'posted' | 'pending' = 'posted',
    ) {
      users.push(userId);
      const crewId = randomUUID();
      crews.push(crewId);
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Withdrawal fixture',
          description: '',
          logo: '',
          createdByUserId: userId,
        },
      });
      const member = await db.crewMember.create({
        data: { id: randomUUID(), crewId, userId, joinedVia: 'creation' },
      });
      const state = await db.crewTaskWorkflowState.create({
        data: {
          crewId,
          name: 'Done',
          color: '#888888',
          semantic: 'approved',
          position: 0,
          createdByUserId: userId,
        },
      });
      const task = await db.crewTask.create({
        data: {
          crewId,
          title: 'Completed task',
          number: 1,
          workflowStateId: state.id,
          createdByUserId: userId,
        },
      });
      const earning = await db.crewEarningEntry.create({
        data: {
          crewId,
          crewMemberId: member.id,
          userId,
          currency,
          amountMinor: amount,
          sourceType: status === 'posted' ? 'task_reward' : 'adjustment',
          status,
          taskId: status === 'posted' ? task.id : null,
          title: 'Task reward',
          idempotencyKey: randomUUID(),
          createdByUserId: userId,
          postedAt: status === 'posted' ? new Date() : null,
          approvedByUserId: status === 'posted' ? userId : null,
        },
      });
      return { userId, crewId, member, earning, task };
    }
    function input(expected = '3000', percentageBps = 10000) {
      return {
        requestId: randomUUID(),
        currency: 'USD' as const,
        percentageBps,
        expectedAvailableAmountMinor: expected,
        recipient,
      };
    }
    it('carries a posted task reward through partial withdrawal, manual payment and retry without paying it twice', async () => {
      // The pending entry is deliberately not withdrawable. Only the real task
      // reward service may introduce the cash used by this journey.
      const { userId, crewId, member, task } = await seed(
        3000n,
        undefined,
        'USD',
        'pending',
      );
      const notifications = new NotificationService(db as PrismaService);
      const earnings = new CrewEarningsService(
        db as PrismaService,
        {} as never,
        notifications,
      );
      const reward = {
        crewId,
        taskId: task.id,
        taskNumber: task.number,
        taskTitle: task.title,
        crewMemberId: member.id,
        userId,
        amountMinor: 3000n,
        currency: 'USD',
        approvedByUserId: userId,
      };
      const posted = await db.$transaction((tx) =>
        earnings.postTaskRewardTx(tx, reward),
      );
      const retry = await db.$transaction((tx) =>
        earnings.postTaskRewardTx(tx, reward),
      );
      expect(retry.id).toBe(posted.id);
      expect((await service.balances(userId))[0]).toMatchObject({
        availableAmountMinor: '3000',
      });
      const requestInput = input('3000', 5000);
      const request = await service.request(userId, requestInput);
      const finance = new WithdrawalAdminService(
        db as PrismaService,
        notifications,
      );
      await finance.decide(admin(), request.id, {
        action: 'process',
        expectedVersion: 1,
      });
      await finance.decide(admin(), request.id, {
        action: 'pay',
        expectedVersion: 2,
        paymentReference: 'fixture-task-settlement',
        paymentProofId: await readyPaymentProof(db, request.id),
      });
      expect((await service.request(userId, requestInput)).id).toBe(request.id);
      expect((await service.history(userId)).items[0]).toMatchObject({
        status: 'paid',
        amountMinor: '1500',
      });
      expect((await service.balances(userId))[0]).toMatchObject({
        availableAmountMinor: '1500',
        reservedAmountMinor: '0',
        paidAmountMinor: '1500',
      });
      expect(
        await db.crewPayoutAllocation.findMany({
          where: { payout: { platformWithdrawalId: request.id } },
          select: { earningId: true, amountMinor: true },
        }),
      ).toEqual([{ earningId: posted.id, amountMinor: 1500n }]);
      expect(
        await db.crewEarningEvent.count({ where: { earningId: posted.id } }),
      ).toBe(1);
      expect(
        await db.notification.count({
          where: { userId, type: 'crew.earning.posted' },
        }),
      ).toBe(1);
    });
    it('uploads verified private proof, audits downloads, and preserves paid evidence during cleanup', async () => {
      const { userId } = await seed();
      const request = await service.request(userId, input());
      const finance = new WithdrawalAdminService(
        db as PrismaService,
        new NotificationService(db as PrismaService),
      );
      const account = await db.adminUser.create({
        data: {
          passwordHash: 'fixture-hash',
          email: `${randomUUID()}@example.invalid`,
          displayName: 'Proof fixture',
          status: 'active',
        },
      });
      const session = await db.adminSession.create({
        data: {
          userId: account.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const actor = { ...admin(account.id), sessionId: session.id };
      const bytes = Buffer.from('%PDF-1.7\nfixture\n%%EOF');
      const storage = {
        createPrivateUploadUrl: jest.fn(
          ({ storageKey }: { storageKey: string }) =>
            Promise.resolve({
              storageKey,
              provider: 's3_compatible',
              bucket: 'fixture-private',
              region: null,
              url: 'https://storage.invalid/put',
              headers: {},
            }),
        ),
        headStoredObject: jest.fn(() =>
          Promise.resolve({
            exists: true,
            sizeBytes: bytes.length,
            contentType: 'application/pdf',
          }),
        ),
        createReadUrl: jest.fn(() =>
          Promise.resolve({
            url: 'https://storage.invalid/read',
            expiresAt: new Date(Date.now() + 60000),
          }),
        ),
        deleteObject: jest.fn().mockResolvedValue(undefined),
      };
      const proofs = new WithdrawalProofsService(
        db as PrismaService,
        { forProvider: () => storage } as unknown as StorageProviderRegistry,
        finance,
      );
      const file = { buffer: bytes, originalname: 'proof.pdf' };
      const network = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      try {
        await expect(proofs.upload(actor, request.id, file)).rejects.toThrow(
          'processing claim',
        );
        await finance.decide(actor, request.id, {
          action: 'process',
          expectedVersion: 1,
        });
        await expect(
          proofs.upload(admin('other'), request.id, file),
        ).rejects.toThrow('processing claim');
        await expect(
          proofs.downloadForCreator(userId, request.id),
        ).rejects.toThrow('not found');
        const proof = await proofs.upload(actor, request.id, file);
        expect(proof).toMatchObject({
          filename: 'proof.pdf',
          sizeBytes: bytes.length,
        });
        expect(await proofs.upload(actor, request.id, file)).toEqual(proof);
        expect(network).toHaveBeenCalledTimes(1);
        await expect(
          proofs.download(admin('other'), request.id, proof.id),
        ).rejects.toThrow('not found');
        await expect(
          proofs.download(actor, request.id, proof.id),
        ).resolves.toMatchObject({ url: 'https://storage.invalid/read' });
        await db.$executeRaw`UPDATE creator_withdrawal_proofs SET next_attempt_at=now()-interval '1 second' WHERE id=${proof.id}::uuid`;
        await proofs.cleanup(proof.id);
        expect(storage.deleteObject).toHaveBeenCalledTimes(1);
        const paidProof = await proofs.upload(actor, request.id, file);
        await finance.decide(actor, request.id, {
          action: 'pay',
          expectedVersion: 2,
          paymentReference: 'proof-service-test',
          paymentProofId: paidProof.id,
        });
        await expect(
          proofs.downloadForCreator('another-creator', request.id),
        ).rejects.toThrow('not found');
        await expect(
          proofs.downloadForCreator(userId, request.id),
        ).resolves.toMatchObject({ url: 'https://storage.invalid/read' });
        expect(storage.createReadUrl).toHaveBeenLastCalledWith(
          expect.objectContaining({
            expiresInSeconds: 60,
            cacheControl: 'private, no-store',
          }),
        );
        const creatorHistory = await service.history(userId);
        expect(
          creatorHistory.items.find((row) => row.id === request.id),
        ).toMatchObject({ hasPaymentProof: true });
        expect(creatorHistory.items[0]).not.toHaveProperty('internalNote');
        await proofs.cleanup(paidProof.id);
        expect(storage.deleteObject).toHaveBeenCalledTimes(1);
        await expect(
          proofs.download(actor, request.id, paidProof.id),
        ).resolves.toMatchObject({ url: 'https://storage.invalid/read' });
        expect(
          await db.adminAuditLog.count({
            where: {
              resourceId: request.id,
              action: 'creator.withdrawal.proof.read',
            },
          }),
        ).toBe(2);
        const interrupted = await seed();
        const pending = await service.request(interrupted.userId, input());
        await finance.decide(actor, pending.id, {
          action: 'process',
          expectedVersion: 1,
        });
        storage.headStoredObject.mockImplementationOnce(async () => {
          await finance.decide(actor, pending.id, {
            action: 'pay',
            expectedVersion: 2,
            paymentReference: 'paid-during-upload',
            paymentProofId: await readyPaymentProof(db, pending.id),
          });
          return {
            exists: true,
            sizeBytes: bytes.length,
            contentType: 'application/pdf',
          };
        });
        await expect(proofs.upload(actor, pending.id, file)).rejects.toThrow(
          'processing claim',
        );
        const [abandoned] = await db.$queryRaw<
          { id: string; status: string; next_attempt_at: Date }[]
        >`SELECT id,status,next_attempt_at FROM creator_withdrawal_proofs WHERE withdrawal_id=${pending.id}::uuid`;
        expect(abandoned.status).toBe('uploading');
        expect(abandoned.next_attempt_at.getTime()).toBeGreaterThan(
          Date.now() + 23 * 60 * 60 * 1000,
        );
        await proofs.cleanup(abandoned.id);
        expect(storage.deleteObject).toHaveBeenCalledTimes(1);
        await db.$executeRaw`UPDATE creator_withdrawal_proofs SET next_attempt_at=now()-interval '1 second' WHERE id=${abandoned.id}::uuid`;
        storage.deleteObject.mockRejectedValueOnce(
          new Error('storage unavailable'),
        );
        await expect(proofs.cleanup(abandoned.id)).rejects.toThrow(
          'storage unavailable',
        );
        expect(
          await db.$queryRaw`SELECT status FROM creator_withdrawal_proofs WHERE id=${abandoned.id}::uuid`,
        ).toEqual([{ status: 'retired' }]);
        await db.$executeRaw`UPDATE creator_withdrawal_proofs SET next_attempt_at=now()-interval '1 second' WHERE id=${abandoned.id}::uuid`;
        await proofs.cleanup(abandoned.id);
        expect(
          await db.$queryRaw`SELECT id FROM creator_withdrawal_proofs WHERE id=${abandoned.id}::uuid`,
        ).toEqual([]);
      } finally {
        network.mockRestore();
        await db.adminAuditLog.deleteMany({
          where: { actorUserId: account.id },
        });
        await db.adminSession.delete({ where: { id: session.id } });
        await db.adminUser.delete({ where: { id: account.id } });
      }
    });
    it('attaches only ready same-withdrawal proof atomically with payment and preserves it immutably', async () => {
      const { userId } = await seed();
      const other = await seed();
      const first = await service.request(userId, input());
      const second = await service.request(other.userId, input());
      const finance = new WithdrawalAdminService(
        db as PrismaService,
        new NotificationService(db as PrismaService),
      );
      await finance.decide(admin(), first.id, {
        action: 'process',
        expectedVersion: 1,
      });
      const proofId = randomUUID();
      await db.$executeRaw`INSERT INTO creator_withdrawal_proofs(id,withdrawal_id,uploaded_by_admin_id,checksum_sha256,filename,content_type,size_bytes,provider,bucket,object_key) VALUES(${proofId}::uuid,${first.id}::uuid,${admin().id},${'a'.repeat(64)},'proof.pdf','application/pdf',100,'s3_compatible','fixture-private',${proofId})`;
      const payment = {
        action: 'pay' as const,
        expectedVersion: 2,
        paymentReference: 'proof-test',
        paymentProofId: proofId,
        internalPaymentNote: 'Finance-only reconciliation note',
      };
      await expect(finance.decide(admin(), first.id, payment)).rejects.toThrow(
        'verified payment proof',
      );
      expect((await finance.detail(admin(), first.id)).status).toBe(
        'processing',
      );
      await db.$executeRaw`UPDATE creator_withdrawal_proofs SET status='ready',verified_at=now() WHERE id=${proofId}::uuid`;
      await finance.decide(admin(), second.id, {
        action: 'process',
        expectedVersion: 1,
      });
      await expect(finance.decide(admin(), second.id, payment)).rejects.toThrow(
        'verified payment proof',
      );
      await finance.decide(admin(), first.id, payment);
      expect(await finance.detail(admin(), first.id)).toMatchObject({
        status: 'paid',
        paymentProofId: proofId,
        internalPaymentNote: payment.internalPaymentNote,
      });
      const history = await service.history(userId);
      expect(JSON.stringify(history)).not.toContain(
        payment.internalPaymentNote,
      );
      expect(
        await db.$queryRaw`SELECT next_attempt_at FROM creator_withdrawal_proofs WHERE id=${proofId}::uuid`,
      ).toEqual([{ next_attempt_at: null }]);
      await expect(
        db.$executeRaw`UPDATE creator_withdrawal_proofs SET status='retired' WHERE id=${proofId}::uuid`,
      ).rejects.toThrow();
      await expect(
        db.$executeRaw`UPDATE creator_withdrawal_proofs SET object_key='replacement' WHERE id=${proofId}::uuid`,
      ).rejects.toThrow();
      await expect(
        db.$executeRaw`UPDATE creator_withdrawal_proofs SET verified_at=now()+interval '1 day' WHERE id=${proofId}::uuid`,
      ).rejects.toThrow();
      await expect(
        db.$executeRaw`DELETE FROM creator_withdrawal_proofs WHERE id=${proofId}::uuid`,
      ).rejects.toThrow();
      await expect(
        db.creatorWithdrawal.update({
          where: { id: first.id },
          data: { paymentProofId: null },
        }),
      ).rejects.toThrow();
      await expect(
        db.creatorWithdrawal.update({
          where: { id: first.id },
          data: { internalPaymentNote: 'replacement' },
        }),
      ).rejects.toThrow();
      await expect(finance.decide(admin(), first.id, payment)).rejects.toThrow(
        'Withdrawal changed',
      );
    });
    it('serializes competing withdrawals and reserves each earning only once', async () => {
      const { userId } = await seed();
      const results = await Promise.allSettled([
        service.request(userId, input()),
        service.request(userId, input()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(failure.reason).toMatchObject({ status: 409 });
      expect(await db.creatorWithdrawal.count({ where: { userId } })).toBe(1);
      const allocations = await db.crewPayoutAllocation.aggregate({
        where: { payout: { userId } },
        _sum: { amountMinor: true },
      });
      expect(allocations._sum.amountMinor).toBe(3000n);
    });
    it('replays simultaneous identical requests without additional reservations or events', async () => {
      const { userId } = await seed();
      const request = input();
      const [a, b] = await Promise.all([
        service.request(userId, request),
        service.request(userId, request),
      ]);
      expect(a).toEqual(b);
      expect(
        await db.creatorWithdrawalEvent.count({
          where: { withdrawalId: a.id },
        }),
      ).toBe(1);
      expect(
        await db.crewPayout.count({ where: { platformWithdrawalId: a.id } }),
      ).toBe(1);
      await expect(
        service.request(userId, {
          ...request,
          recipient: { ...recipient, accountNumber: 'different' },
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it('calculates the percentage after existing reservations, retaining separate currencies and pending earnings', async () => {
      const { userId, crewId, member, earning } = await seed();
      await seed(7000n, userId, 'CNY');
      await seed(9000n, userId, 'USD', 'pending');
      await db.$transaction(async (tx) => {
        const payout = await tx.crewPayout.create({
          data: {
            crewId,
            crewMemberId: member.id,
            userId,
            currency: 'USD',
            amountMinor: 1000n,
            netAmountMinor: 1000n,
            idempotencyKey: randomUUID(),
            createdByUserId: userId,
          },
        });
        await tx.crewPayoutAllocation.create({
          data: {
            crewId,
            earningId: earning.id,
            payoutId: payout.id,
            amountMinor: 1000n,
          },
        });
      });
      const result = await service.request(userId, input('2000', 2500));
      expect(result.amountMinor).toBe('500');
      const saved = await db.creatorPayoutAccount.findUniqueOrThrow({
        where: { userId },
      });
      expect(saved.detailsEncrypted).not.toContain(recipient.accountNumber);
      expect(
        decryptRecipient(saved.detailsEncrypted, `payout-account:${userId}`),
      ).toEqual(recipient);
    });
    it('returns creator-scoped balances, reusable bank details and masked history', async () => {
      const { userId } = await seed();
      await seed(9000n, userId, 'USD', 'pending');
      await seed(7000n, userId, 'CNY');
      const other = await seed(5555n);
      expect(await service.savedRecipient(userId)).toBeNull();
      const request = await service.request(userId, input('3000', 5000));
      expect(await service.balances(userId)).toEqual([
        {
          currency: 'CNY',
          pendingAmountMinor: '0',
          confirmedAmountMinor: '7000',
          reservedAmountMinor: '0',
          paidAmountMinor: '0',
          availableAmountMinor: '7000',
        },
        {
          currency: 'USD',
          // Pending adjustments are not task cash or confirmed platform revenue.
          pendingAmountMinor: '0',
          confirmedAmountMinor: '3000',
          reservedAmountMinor: '1500',
          paidAmountMinor: '0',
          availableAmountMinor: '1500',
        },
      ]);
      expect((await service.savedRecipient(userId))?.recipient).toEqual(
        recipient,
      );
      expect(await service.savedRecipient(other.userId)).toBeNull();
      const history = await service.history(userId);
      expect(history.items).toHaveLength(1);
      expect(history.items[0].id).toBe(request.id);
      expect(JSON.stringify(history)).not.toContain(recipient.accountNumber);
      expect((await service.history(other.userId)).items).toEqual([]);
      await expect(
        service.history(other.userId, request.id),
      ).rejects.toMatchObject({ status: 400 });
    });
    it('rolls back reservations and the request when saving the recipient fails', async () => {
      const { userId } = await seed();
      const failing = db.$extends({
        query: {
          creatorPayoutAccount: {
            upsert() {
              throw new Error('Fixture storage failure');
            },
          },
        },
      });
      const failingService = new CreatorWithdrawalsService(
        failing as unknown as PrismaService,
      );
      await expect(failingService.request(userId, input())).rejects.toThrow(
        'Fixture storage failure',
      );
      expect(await db.creatorWithdrawal.count({ where: { userId } })).toBe(0);
      expect(await db.crewPayout.count({ where: { userId } })).toBe(0);
      expect((await service.request(userId, input())).amountMinor).toBe('3000');
    });
    function admin(id = 'fixture-finance'): AdminActor {
      return {
        id,
        email: 'finance@example.invalid',
        displayName: 'Finance fixture',
        status: 'active',
        siteScope: 'all',
        sessionId: 'fixture-session',
        roleKeys: [],
        requireMfa: true,
        permissions: [WITHDRAWAL_MANAGE_PERMISSION],
      };
    }
    it('only one administrator can claim a request and payment settles every reservation atomically', async () => {
      const { userId } = await seed(1000n);
      await seed(2000n, userId);
      const request = await service.request(userId, input());
      const finance = new WithdrawalAdminService(
        db as PrismaService,
        new NotificationService(db as PrismaService),
      );
      const claims = await Promise.allSettled([
        finance.decide(admin('finance-a'), request.id, {
          action: 'process',
          expectedVersion: 1,
        }),
        finance.decide(admin('finance-b'), request.id, {
          action: 'process',
          expectedVersion: 1,
        }),
      ]);
      expect(claims.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const processing = await db.creatorWithdrawal.findUniqueOrThrow({
        where: { id: request.id },
      });
      const owner = admin(processing.processingAdminId!);
      await expect(
        finance.decide(admin('outsider'), request.id, {
          action: 'pay',
          expectedVersion: 2,
          paymentReference: 'transfer-1',
          paymentProofId: await readyPaymentProof(db, request.id),
        }),
      ).rejects.toMatchObject({ status: 409 });
      await finance.decide(owner, request.id, {
        action: 'pay',
        expectedVersion: 2,
        paymentReference: 'transfer-1',
        paymentProofId: await readyPaymentProof(db, request.id),
      });
      expect(
        await db.crewPayout.count({
          where: { platformWithdrawalId: request.id, status: 'paid' },
        }),
      ).toBe(2);
      expect((await service.history(userId)).items[0]).toMatchObject({
        status: 'paid',
        version: 3,
      });
      expect((await service.balances(userId))[0]).toMatchObject({
        availableAmountMinor: '0',
        reservedAmountMinor: '0',
        paidAmountMinor: '3000',
      });
      await expect(
        finance.decide(owner, request.id, {
          action: 'pay',
          expectedVersion: 2,
          paymentReference: 'transfer-1',
          paymentProofId: await readyPaymentProof(db, request.id),
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await db.creatorWithdrawalEvent.count({
          where: { withdrawalId: request.id },
        }),
      ).toBe(3);
      const notices = await db.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      expect(notices.map((notice) => notice.type)).toEqual([
        'crew.withdrawal.processing',
        'crew.withdrawal.paid',
      ]);
      expect(notices[1].meta).toMatchObject({
        withdrawalId: request.id,
        amountMinor: '3000',
        currency: 'USD',
        deeplink: '/crews/income',
      });
      expect(JSON.stringify(notices)).not.toContain(recipient.accountNumber);
      expect(JSON.stringify(notices)).not.toContain('transfer-1');
      expect(await db.notificationOutbox.count({ where: { userId } })).toBe(2);
    });
    it.each(['process', 'pay', 'reject'] as const)(
      'rolls back %s if its notification outbox cannot be written',
      async (action) => {
        const { userId } = await seed();
        const request = await service.request(userId, input());
        const finance = new WithdrawalAdminService(
          db as PrismaService,
          new NotificationService(db as PrismaService),
        );
        if (action === 'pay')
          await finance.decide(admin(), request.id, {
            action: 'process',
            expectedVersion: 1,
          });
        const expectedVersion = action === 'pay' ? 2 : 1;
        const failing = db.$extends({
          query: {
            notificationOutbox: {
              create() {
                throw new Error('Fixture notification failure');
              },
            },
          },
        });
        const failingFinance = new WithdrawalAdminService(
          failing as unknown as PrismaService,
          new NotificationService(db as PrismaService),
        );
        await expect(
          failingFinance.decide(
            admin(),
            request.id,
            action === 'pay'
              ? {
                  action,
                  expectedVersion,
                  paymentReference: 'fixture-transfer',
                  paymentProofId: await readyPaymentProof(db, request.id),
                }
              : action === 'reject'
                ? { action, expectedVersion, reason: 'Check bank details' }
                : { action, expectedVersion },
          ),
        ).rejects.toThrow('Fixture notification failure');
        expect((await service.history(userId)).items[0]).toMatchObject({
          status: action === 'pay' ? 'processing' : 'pending',
          version: expectedVersion,
          paidAt: null,
        });
        expect(
          await db.crewPayout.count({
            where: { platformWithdrawalId: request.id, status: 'pending' },
          }),
        ).toBe(1);
        expect(
          await db.creatorWithdrawalEvent.count({
            where: { withdrawalId: request.id },
          }),
        ).toBe(expectedVersion);
        expect(await db.notification.count({ where: { userId } })).toBe(
          action === 'pay' ? 1 : 0,
        );
        expect(await db.notificationOutbox.count({ where: { userId } })).toBe(
          action === 'pay' ? 1 : 0,
        );
      },
    );
    it('rolls back a payment if its admin audit event cannot be recorded', async () => {
      const { userId } = await seed();
      const request = await service.request(userId, input());
      const finance = new WithdrawalAdminService(
        db as PrismaService,
        new NotificationService(db as PrismaService),
      );
      await finance.decide(admin(), request.id, {
        action: 'process',
        expectedVersion: 1,
      });
      const failing = db.$extends({
        query: {
          creatorWithdrawalEvent: {
            create() {
              throw new Error('Fixture audit failure');
            },
          },
        },
      });
      const failingFinance = new WithdrawalAdminService(
        failing as unknown as PrismaService,
        new NotificationService(db as PrismaService),
      );
      await expect(
        failingFinance.decide(admin(), request.id, {
          action: 'pay',
          expectedVersion: 2,
          paymentReference: 'fixture-transfer',
          paymentProofId: await readyPaymentProof(db, request.id),
        }),
      ).rejects.toThrow('Fixture audit failure');
      expect((await service.history(userId)).items[0]).toMatchObject({
        status: 'processing',
        version: 2,
        paidAt: null,
      });
      expect(
        await db.crewPayout.count({
          where: { platformWithdrawalId: request.id, status: 'pending' },
        }),
      ).toBe(1);
      expect((await service.balances(userId))[0]).toMatchObject({
        reservedAmountMinor: '3000',
        paidAmountMinor: '0',
      });
    });
    it('requires finance permission and releases rejected reservations for a new request', async () => {
      const { userId } = await seed();
      const request = await service.request(userId, input());
      const finance = new WithdrawalAdminService(
        db as PrismaService,
        new NotificationService(db as PrismaService),
      );
      await expect(
        finance.decide({ ...admin(), permissions: [] }, request.id, {
          action: 'process',
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        finance.decide(admin(), request.id, {
          action: 'pay',
          expectedVersion: 1,
          paymentReference: 'transfer',
          paymentProofId: await readyPaymentProof(db, request.id),
        }),
      ).rejects.toMatchObject({ status: 409 });
      await finance.decide(admin(), request.id, {
        action: 'reject',
        expectedVersion: 1,
        reason: 'Please correct recipient details.',
      });
      expect((await service.balances(userId))[0].availableAmountMinor).toBe(
        '3000',
      );
      expect((await service.request(userId, input())).amountMinor).toBe('3000');
      expect(
        (await service.history(userId)).items.find((r) => r.id === request.id),
      ).toMatchObject({
        status: 'rejected',
        resolutionReason: 'Please correct recipient details.',
      });
    });
    it('shows currency-separated admin totals and a masked, filtered queue', async () => {
      const finance = new WithdrawalAdminService(
        db as PrismaService,
        new NotificationService(db as PrismaService),
      );
      const before = (await finance.overview(admin())).find(
        (r) => r.currency === 'USD',
      )!;
      const { userId } = await seed();
      const request = await service.request(userId, input('3000', 5000));
      const after = (await finance.overview(admin())).find(
        (r) => r.currency === 'USD',
      )!;
      expect(
        BigInt(after.pendingAmountMinor) - BigInt(before.pendingAmountMinor),
      ).toBe(1500n);
      expect(
        BigInt(after.availableAmountMinor) -
          BigInt(before.availableAmountMinor),
      ).toBe(1500n);
      const detail = await finance.detail(admin(), request.id);
      expect(detail.earnings).toHaveLength(1);
      expect(detail.earnings[0]).toMatchObject({
        title: 'Task reward',
        earnedAmountMinor: '3000',
        withdrawalAmountMinor: '1500',
      });
      expect(detail.events).toHaveLength(1);
      expect(detail.events[0]).toMatchObject({
        actorType: 'creator',
        actorId: userId,
        action: 'requested',
      });
      expect(JSON.stringify(detail)).not.toContain(recipient.accountNumber);
      expect(detail).not.toHaveProperty('recipientEncrypted');
      const queue = await finance.queue(admin(), { userId });
      expect(queue.total).toBe(1);
      expect(queue.items[0]).toMatchObject({
        id: request.id,
        amountMinor: '1500',
      });
      expect(JSON.stringify(queue)).not.toContain(recipient.accountNumber);
      const csv = await finance.exportCsv(admin(), {
        userId,
        currency: 'USD',
        minAmountMinor: '1500',
        maxAmountMinor: '1500',
      });
      expect(csv.count).toBe(1);
      expect(csv.csv).toContain(request.id);
      expect(csv.csv).toContain('"15.00"');
      expect(csv.csv).not.toContain(recipient.accountNumber);
      expect(
        (
          await finance.exportCsv(admin(), {
            userId,
            currency: 'USD',
            minAmountMinor: '1501',
          })
        ).count,
      ).toBe(0);

      const today = new Date().toISOString().slice(0, 10);
      expect(
        (
          await finance.queue(admin(), {
            userId,
            q: request.id,
            currency: 'USD',
            from: today,
            to: today,
            minAmountMinor: '1500',
            maxAmountMinor: '1500',
          })
        ).items.map((row) => row.id),
      ).toEqual([request.id]);
      expect(
        (
          await finance.queue(admin(), {
            userId,
            q: 'Fixture',
            currency: 'USD',
            maxAmountMinor: '1499',
          })
        ).total,
      ).toBe(0);
      expect(
        (
          await finance.queue(admin(), {
            userId,
            from: '2000-01-01',
            to: '2000-01-02',
          })
        ).total,
      ).toBe(0);
      await expect(
        finance.queue(admin(), { minAmountMinor: '1' }),
      ).rejects.toThrow('Choose a currency');
      await expect(
        finance.queue(admin(), {
          currency: 'USD',
          minAmountMinor: '2',
          maxAmountMinor: '1',
        }),
      ).rejects.toThrow('Minimum amount');
      await expect(
        finance.queue(admin(), { from: '2026-10-07', to: '2026-10-06' }),
      ).rejects.toThrow('Start date');

      await expect(
        finance.queue({ ...admin(), siteScope: 'cn' }, {}),
      ).rejects.toMatchObject({ status: 403 });
    });
    it('audits controlled handover, preserves reservations and rejects the previous operator', async () => {
      const { userId } = await seed();
      const request = await service.request(userId, input());
      const finance = new WithdrawalAdminService(
        db as PrismaService,
        new NotificationService(db as PrismaService),
      );
      await finance.decide(admin('old-operator'), request.id, {
        action: 'process',
        expectedVersion: 1,
      });
      const account = await db.adminUser.create({
        data: {
          passwordHash: 'fixture-hash',
          email: `${randomUUID()}@example.invalid`,
          displayName: 'Controller fixture',
          status: 'active',
        },
      });
      const session = await db.adminSession.create({
        data: {
          userId: account.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const controller = {
        ...admin(account.id),
        sessionId: session.id,
        roleKeys: ['master_financial_controller'],
      };
      const takeover = {
        action: 'takeover' as const,
        expectedVersion: 2,
        reason: 'Previous operator unavailable; checked transfer records',
        transferHistoryReviewed: true as const,
      };
      try {
        await expect(
          finance.decide(admin('ordinary'), request.id, takeover),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          finance.decide(controller, request.id, {
            ...takeover,
            transferHistoryReviewed: false,
          } as never),
        ).rejects.toThrow();
        const failing = db.$extends({
          query: {
            adminAuditLog: {
              create() {
                throw new Error('Handover audit unavailable');
              },
            },
          },
        });
        await expect(
          new WithdrawalAdminService(
            failing as unknown as PrismaService,
            new NotificationService(db as PrismaService),
          ).decide(controller, request.id, takeover),
        ).rejects.toThrow('Handover audit unavailable');
        expect(
          await db.creatorWithdrawal.findUnique({ where: { id: request.id } }),
        ).toMatchObject({ version: 2, processingAdminId: 'old-operator' });
        expect(
          await db.creatorWithdrawalEvent.count({
            where: { withdrawalId: request.id },
          }),
        ).toBe(2);
        const attempts = await Promise.allSettled([
          finance.decide(controller, request.id, takeover),
          finance.decide(controller, request.id, takeover),
        ]);
        expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(
          1,
        );
        expect(
          await db.creatorWithdrawal.findUnique({ where: { id: request.id } }),
        ).toMatchObject({
          version: 3,
          status: 'processing',
          processingAdminId: account.id,
          paidAt: null,
        });
        expect((await service.balances(userId))[0]).toMatchObject({
          reservedAmountMinor: '3000',
          paidAmountMinor: '0',
        });
        expect(
          await db.adminAuditLog.findFirst({
            where: { resourceId: request.id },
          }),
        ).toMatchObject({
          action: 'creator.withdrawal.reassigned',
          metadata: {
            previousOperatorId: 'old-operator',
            newOperatorId: account.id,
            reason: takeover.reason,
            transferHistoryReviewed: true,
          },
        });
        await expect(
          finance.decide(admin('old-operator'), request.id, {
            action: 'pay',
            expectedVersion: 3,
            paymentReference: 'duplicate',
            paymentProofId: await readyPaymentProof(db, request.id),
          }),
        ).rejects.toMatchObject({ status: 409 });
        await finance.decide(controller, request.id, {
          action: 'pay',
          expectedVersion: 3,
          paymentReference: 'verified-transfer',
          paymentProofId: await readyPaymentProof(db, request.id),
        });
        await expect(
          finance.decide({ ...controller, id: 'other' }, request.id, {
            ...takeover,
            expectedVersion: 4,
          }),
        ).rejects.toMatchObject({ status: 409 });
      } finally {
        await db.adminAuditLog.deleteMany({
          where: { actorUserId: account.id },
        });
        await db.adminSession.delete({ where: { id: session.id } });
        await db.adminUser.delete({ where: { id: account.id } });
      }
    });
    it('audits bank-detail access and returns no details when the audit fails', async () => {
      const { userId } = await seed();
      const request = await service.request(userId, input());
      const account = await db.adminUser.create({
        data: {
          passwordHash: 'local-fixture-not-a-login-hash',
          email: `${randomUUID()}@example.invalid`,
          displayName: 'Finance fixture',
          status: 'active',
        },
      });
      const session = await db.adminSession.create({
        data: {
          userId: account.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const actor = { ...admin(account.id), sessionId: session.id };
      try {
        const finance = new WithdrawalAdminService(
          db as PrismaService,
          new NotificationService(db as PrismaService),
        );
        expect(await finance.recipient(actor, request.id)).toEqual({
          recipient,
        });
        const audit = await db.adminAuditLog.findFirstOrThrow({
          where: { actorUserId: account.id },
        });
        expect(audit.action).toBe('creator.withdrawal.recipient.read');
        expect(JSON.stringify(audit)).not.toContain(recipient.accountNumber);
        const failing = db.$extends({
          query: {
            adminAuditLog: {
              create() {
                throw new Error('Audit unavailable');
              },
            },
          },
        });
        await expect(
          new WithdrawalAdminService(
            failing as unknown as PrismaService,
            new NotificationService(db as PrismaService),
          ).recipient(actor, request.id),
        ).rejects.toThrow('Audit unavailable');
      } finally {
        await db.adminAuditLog.deleteMany({
          where: { actorUserId: account.id },
        });
        await db.adminSession.delete({ where: { id: session.id } });
        await db.adminUser.delete({ where: { id: account.id } });
      }
    });
    it('database rejects inconsistent amounts and paid status without payment evidence', async () => {
      const { userId } = await seed();
      const result = await service.request(userId, input());
      await expect(
        db.creatorWithdrawal.update({
          where: { id: result.id },
          data: { amountMinor: 2999n },
        }),
      ).rejects.toThrow();
      await expect(
        db.creatorWithdrawal.update({
          where: { id: result.id },
          data: { status: 'paid' },
        }),
      ).rejects.toThrow();
      await expect(
        db.creatorWithdrawal.update({
          where: { id: result.id },
          data: {
            status: 'paid',
            paidAt: new Date(),
            paidAdminId: 'fixture-admin',
            processingAdminId: 'fixture-admin',
            paymentReference: 'fixture-transfer',
          },
        }),
      ).rejects.toThrow();
      const child = await db.crewPayout.findFirstOrThrow({
        where: { platformWithdrawalId: result.id },
      });
      await expect(
        db.crewPayout.update({
          where: { id: child.id },
          data: { platformWithdrawalId: null },
        }),
      ).rejects.toThrow();
      await expect(
        db.crewPayout.update({
          where: { id: child.id },
          data: { status: 'voided' },
        }),
      ).rejects.toThrow();
      expect(
        (
          await db.creatorWithdrawal.findUniqueOrThrow({
            where: { id: result.id },
          })
        ).status,
      ).toBe('pending');
    });
  },
);

async function readyPaymentProof(db: PrismaClient, withdrawalId: string) {
  const id = randomUUID();
  await db.$executeRaw`INSERT INTO creator_withdrawal_proofs(id,withdrawal_id,uploaded_by_admin_id,checksum_sha256,filename,content_type,size_bytes,provider,bucket,object_key,status,verified_at)
 VALUES(${id}::uuid,${withdrawalId}::uuid,'fixture-finance',${id.replaceAll('-', '').repeat(2)},'proof.pdf','application/pdf',100,'s3_compatible','fixture-private',${id},'ready',now())`;
  return id;
}
