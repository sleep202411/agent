import type { AdminActor } from '../../admin-auth';
import { PrismaService } from '../../infra/db/db.module';
import { CrewEarningsService } from '../earnings/earnings.service';
import {
  ReleaseTaskPayment,
  TaskPaymentsService,
} from './task-payments.service';
const id = '11111111-1111-4111-8111-111111111111';
const admin = {
  id: '22222222-2222-4222-8222-222222222222',
  status: 'active',
  siteScope: 'all',
  permissions: ['creator.revenue.manage'],
} as AdminActor;
const input = {
  userId: 'creator',
  expectedVersion: 3,
  expectedAmountMinor: '10000',
  currency: 'USD' as const,
  paymentTerms: 'half_upfront' as const,
  receiptReference: 'BANK-RECEIPT',
  milestoneEvidence: 'Production milestone reviewed',
  fundsReceived: true as const,
  milestoneConfirmed: true as const,
};
function fixture(term = 'half_upfront', status = 'in_progress') {
  const task = {
    id,
    crewId: 'crew',
    number: 1,
    title: 'Film',
    version: 3,
    workflowState: { semantic: status },
    metadata: { compensation: { paymentTerms: term } },
    assignees: [
      {
        userId: 'creator',
        crewMemberId: 'member',
        rewardAmountMinor: 10000n,
        currency: 'USD',
      },
    ],
  };
  const tx = {
    crewTask: {
      findFirst: jest.fn().mockResolvedValue(task),
      findFirstOrThrow: jest.fn().mockResolvedValue(task),
    },
    crewApplication: { findFirst: jest.fn().mockResolvedValue(null) },
    taskPaymentRelease: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'release' }),
    },
    crewEarningEntry: { findUnique: jest.fn().mockResolvedValue(null) },
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const db = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
  const earnings = { postTaskRewardTx: jest.fn() };
  return {
    task,
    tx,
    earnings,
    service: new TaskPaymentsService(
      db as unknown as PrismaService,
      earnings as unknown as CrewEarningsService,
    ),
  };
}
it('releases the exact agreed amount only after the authorized FD Admin confirms receipt and milestone', async () => {
  const f = fixture();
  await f.service.release(admin, id, input);
  expect(f.earnings.postTaskRewardTx).toHaveBeenCalledWith(
    f.tx,
    expect.objectContaining({
      userId: 'creator',
      amountMinor: 10000n,
      currency: 'USD',
      approvedByUserId: `admin:${admin.id}`,
    }),
  );
  expect(f.tx.taskPaymentRelease.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        confirmedByAdminId: admin.id,
        receiptReference: input.receiptReference,
        milestoneEvidence: input.milestoneEvidence,
      }) as unknown,
    }),
  );
});
it.each([
  { ...admin, permissions: [] },
  { ...admin, status: 'disabled' },
])('rejects unauthorized actors before any transaction', async (actor) => {
  const f = fixture();
  await expect(
    f.service.release(actor as AdminActor, id, input),
  ).rejects.toThrow('permission');
  expect(f.tx.crewTask.findFirst).not.toHaveBeenCalled();
});
it('requires both confirmations and receipt evidence in the API contract', () => {
  for (const invalid of [
    { fundsReceived: false },
    { milestoneConfirmed: false },
    { receiptReference: '' },
    { milestoneEvidence: '' },
  ])
    expect(ReleaseTaskPayment.safeParse({ ...input, ...invalid }).success).toBe(
      false,
    );
});
it('completion rewards remain blocked before approved delivery', async () => {
  const f = fixture('on_completion');
  await expect(
    f.service.release(admin, id, { ...input, paymentTerms: 'on_completion' }),
  ).rejects.toThrow('approved');
  expect(f.earnings.postTaskRewardTx).not.toHaveBeenCalled();
});
it('Demo Promise cannot become a cash release through this endpoint', async () => {
  const f = fixture('demo_promise');
  await expect(f.service.release(admin, id, input)).rejects.toThrow(
    'terms changed',
  );
});
it.each([
  { expectedVersion: 2 },
  { expectedAmountMinor: '9999' },
  { currency: 'CNY' as const },
  { userId: 'outsider' },
])('rejects stale or redirected payment details', async (change) => {
  const f = fixture();
  await expect(
    f.service.release(admin, id, { ...input, ...change }),
  ).rejects.toThrow();
  expect(f.earnings.postTaskRewardTx).not.toHaveBeenCalled();
});
it('honors confirmed per-creator recruitment terms over task defaults', async () => {
  const f = fixture();
  f.tx.crewApplication.findFirst.mockResolvedValue({
    termsVersion: 2,
    terms: [
      { version: 2, confirmedAt: new Date(), paymentTerms: 'demo_promise' },
    ],
  });
  await expect(f.service.release(admin, id, input)).rejects.toThrow(
    'terms changed',
  );
});
it('replays a recorded release without posting another earning', async () => {
  const f = fixture();
  f.tx.taskPaymentRelease.findUnique.mockResolvedValue({
    ...input,
    id: 'release',
    amountMinor: 10000n,
  });
  expect(await f.service.release(admin, id, input)).toEqual({ id: 'release' });
  expect(f.earnings.postTaskRewardTx).not.toHaveBeenCalled();
  await expect(
    f.service.release(admin, id, { ...input, receiptReference: 'changed' }),
  ).rejects.toThrow('different details');
});
it('refuses to duplicate a historical task reward', async () => {
  const f = fixture();
  f.tx.crewEarningEntry.findUnique.mockResolvedValue({ id: 'earning' });
  await expect(f.service.release(admin, id, input)).rejects.toThrow(
    'already recorded',
  );
  expect(f.tx.taskPaymentRelease.create).not.toHaveBeenCalled();
});
