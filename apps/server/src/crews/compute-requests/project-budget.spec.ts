import { ConflictException } from '@nestjs/common';
import type { AdminActor } from '../../admin-auth';
import { ProjectBudgetService } from './project-budget.service';
import {
  projectBudgetPoints,
  producerNetAmount,
  requireProjectBudgetAllowance,
  type ProjectBudget,
} from './project-budget';
const crewId = 'crew';
const taskId = '11111111-1111-4111-8111-111111111111';
const admin = {
  id: 'admin',
  status: 'active',
  siteScope: 'all',
  sessionId: 'session',
  permissions: ['crew.compute.review', 'creator.revenue.manage'],
} as AdminActor;
const plan = (): ProjectBudget => ({
  crewId,
  workspaceId: '22222222-2222-4222-8222-222222222222',
  version: 1,
  data: {
    durationSeconds: 60,
    totalPoints: '4462',
    producerTaskId: taskId,
    producerUserId: 'producer',
    stages: [],
    settlement: null,
  },
});
function fixture(initial: ProjectBudget | null = plan()) {
  let budget = initial;
  let consumed = 5000n,
    committed = 5000n;
  const tx = {
    $queryRaw: jest.fn(() =>
      Promise.resolve(budget ? [structuredClone(budget)] : []),
    ),
    $executeRaw: jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (strings.join('').includes('UPDATE crew_project_compute_budgets'))
          budget = {
            ...budget!,
            version: budget!.version + 1,
            data: JSON.parse(String(values[0])) as ProjectBudget['data'],
          };
        return Promise.resolve(1);
      },
    ),
    crew: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ workspaceId: plan().workspaceId }),
    },
    walletAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'wallet', status: 'active' }),
    },
    walletLedgerEntry: {
      aggregate: jest.fn(() =>
        Promise.resolve({
          _sum: { amount: consumed, availableDelta: -committed },
        }),
      ),
    },
    crewTask: {
      findFirst: jest.fn().mockResolvedValue({
        metadata: { compensation: { paymentTerms: 'on_completion' } },
        assignees: [
          { userId: 'producer', rewardAmountMinor: 10000n, currency: 'USD' },
        ],
      }),
    },
    crewApplication: { findFirst: jest.fn().mockResolvedValue(null) },
    crewEarningEntry: { findUnique: jest.fn().mockResolvedValue(null) },
    taskPaymentRelease: { findUnique: jest.fn().mockResolvedValue(null) },
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const db = { ...tx, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
  return {
    tx,
    service: new ProjectBudgetService(db as never),
    budget: () => budget,
    usage: (c: bigint, h: bigint) => {
      consumed = c;
      committed = h;
    },
  };
}
it('calculates a whole-project allowance at 4460/minute, rounding fractional points up once', () => {
  expect(projectBudgetPoints(60)).toBe(4460n);
  expect(projectBudgetPoints(600)).toBe(44600n);
  expect(projectBudgetPoints(1)).toBe(75n);
  expect(() => projectBudgetPoints(0)).toThrow();
});
const release = {
  action: 'release',
  expectedVersion: 1,
  requestKey: '33333333-3333-4333-8333-333333333333',
  points: 2000,
  allowOverrun: false,
  note: 'First production stage',
};
it('releases a stage once and rejects a reused key with different amounts', async () => {
  const f = fixture();
  await f.service.change(admin, crewId, release);
  await f.service.change(admin, crewId, release);
  expect(f.budget()!.data.stages).toHaveLength(1);
  expect(f.tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
  await expect(
    f.service.change(admin, crewId, { ...release, points: 2001 }),
  ).rejects.toThrow('different');
});
it('requires explicit overrun authorization and prevents stale stage updates', async () => {
  const f = fixture();
  await expect(
    f.service.change(admin, crewId, { ...release, points: 5000 }),
  ).rejects.toThrow('exceeds');
  await f.service.change(admin, crewId, {
    ...release,
    points: 5000,
    allowOverrun: true,
  });
  await expect(
    f.service.change(admin, crewId, {
      ...release,
      requestKey: '44444444-4444-4444-8444-444444444444',
    }),
  ).rejects.toThrow('changed');
});
const close = {
  action: 'close',
  expectedVersion: 1,
  expectedConsumedPoints: '5000',
  expectedGrossMinor: '10000',
  deductionMinor: '1000',
  note: 'Accepted overrun adjustment; evidence CASE-12',
};
it('requires finance permission for deductions, even with compute approval rights', async () => {
  await expect(
    fixture().service.change(
      { ...admin, permissions: ['crew.compute.review'] },
      crewId,
      close,
    ),
  ).rejects.toThrow('revenue');
});
it('waits for holds and rejects changed spend, deductions above the fee and deductions without an overrun', async () => {
  const f = fixture();
  f.usage(5000n, 5100n);
  await expect(f.service.change(admin, crewId, close)).rejects.toThrow('holds');
  f.usage(5001n, 5001n);
  await expect(f.service.change(admin, crewId, close)).rejects.toThrow(
    'changed',
  );
  f.usage(5000n, 5000n);
  await expect(
    f.service.change(admin, crewId, { ...close, deductionMinor: '10001' }),
  ).rejects.toThrow('Deduction');
  f.usage(100n, 100n);
  await expect(
    f.service.change(admin, crewId, {
      ...close,
      expectedConsumedPoints: '100',
    }),
  ).rejects.toThrow('Deduction');
});
it('freezes compute, records the adjustment, and calculates only the approved net payout', async () => {
  const f = fixture();
  await f.service.change(admin, crewId, close);
  expect(
    producerNetAmount(f.budget(), taskId, 'producer', 10000n, 'USD'),
  ).toEqual({ net: 9000n, deduction: 1000n });
  expect(() =>
    producerNetAmount(f.budget(), taskId, 'producer', 11000n, 'USD'),
  ).toThrow('changed');
  await expect(
    requireProjectBudgetAllowance(f.tx as never, plan().workspaceId, 1n),
  ).rejects.toThrow('closed');
  expect(f.tx.adminAuditLog.create).toHaveBeenCalled();
});
it('blocks final producer payment before closure and does not alter other creator fees', () => {
  expect(() =>
    producerNetAmount(plan(), taskId, 'producer', 10000n, 'USD'),
  ).toThrow(ConflictException);
  expect(producerNetAmount(plan(), taskId, 'artist', 100n, 'USD')).toEqual({
    net: 100n,
    deduction: 0n,
  });
});
it('allows documented reconsideration before payment but never reopens a paid settlement', async () => {
  const f = fixture();
  await f.service.change(admin, crewId, close);
  f.tx.taskPaymentRelease.findUnique.mockResolvedValue({ id: 'paid' });
  await expect(
    f.service.change(admin, crewId, {
      action: 'reopen',
      expectedVersion: 2,
      note: 'Appeal',
    }),
  ).rejects.toThrow('already');
  f.tx.taskPaymentRelease.findUnique.mockResolvedValue(null);
  await f.service.change(admin, crewId, {
    action: 'reopen',
    expectedVersion: 2,
    note: 'Appeal',
  });
  expect(f.budget()!.data.settlement).toBeNull();
});
it('counts held and settled spending against released stages', async () => {
  const b = plan();
  b.data.stages = [
    {
      key: release.requestKey,
      points: 100,
      note: 'Stage',
      adminId: admin.id,
      at: new Date().toISOString(),
    },
  ];
  const f = fixture(b);
  f.usage(50n, 80n);
  await expect(
    requireProjectBudgetAllowance(f.tx as never, b.workspaceId, 21n),
  ).rejects.toThrow('released');
  await expect(
    requireProjectBudgetAllowance(f.tx as never, b.workspaceId, 20n),
  ).resolves.toBeUndefined();
});

it('blocks crew workspace generation until a project budget is configured', async () => {
  const f = fixture(null);
  f.tx.$queryRaw
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: 'crew' }] as never);
  await expect(
    requireProjectBudgetAllowance(f.tx as never, plan().workspaceId, 1n),
  ).rejects.toThrow('Configure');
});
