import type { AdminActor } from '../../admin-auth';
const admin = {
  id: 'admin',
  status: 'active',
  sessionId: 'session',
  siteScope: 'all',
  permissions: ['crew.compute.review'],
  roleKeys: ['super_admin'],
} as AdminActor;
const contains = (value: unknown): unknown => expect.objectContaining(value);
import { CrewComputeRequestsService } from './compute-requests.service';
import { requireCrewComputeAllowance } from './compute-allowance';
import { CreateComputeRequestSchema } from './compute-requests.controller';

function fixture(owner = true) {
  const request = {
    id: 'request',
    crewId: 'crew',
    taskId: 'task',
    taskTitle: 'Shot',
    workspaceId: 'workspace',
    userId: 'creator',
    points: 50,
    reason: 'Render',
    requestKey: 'key',
    status: 'pending',
    createdAt: new Date(),
  };
  const task = {
    id: 'task',
    title: 'Shot',
    canvasProjectId: 'project',
    crew: { workspaceId: 'workspace' },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([
      {
        crewId: 'crew',
        workspaceId: 'workspace',
        version: 1,
        data: {
          durationSeconds: 60,
          totalPoints: '4462',
          producerTaskId: '11111111-1111-4111-8111-111111111111',
          producerUserId: 'producer',
          stages: [
            {
              key: '33333333-3333-4333-8333-333333333333',
              points: 100,
              note: 'Stage',
              adminId: 'admin',
              at: 'today',
            },
          ],
          settlement: null,
        },
      },
    ]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    crewTask: {
      findFirst: jest.fn().mockResolvedValue(task),
      findMany: jest.fn().mockResolvedValue([]),
    },
    crewComputeRequest: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { points: 0 } }),
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ ...request })),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...request, ...data }),
        ),
      update: jest.fn().mockImplementation(({ data }) => {
        Object.assign(request, data);
        return Promise.resolve({ ...request });
      }),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
    walletAccount: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'wallet',
        status: 'active',
        availableBalance: 100n,
      }),
    },
    walletLedgerEntry: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 25n } }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: (run: (db: typeof tx) => unknown) => run(tx),
  };
  const authorization = {
    resolve: jest.fn().mockResolvedValue({ isOwner: owner }),
  };
  const service = new CrewComputeRequestsService(
    prisma as never,
    authorization as never,
  );
  return { service, tx, authorization, request };
}

describe('Crew compute requests', () => {
  it.each([0, -1, 1.5, 2_000_000_001])(
    'rejects invalid points %s',
    (points) => {
      expect(
        CreateComputeRequestSchema.safeParse({
          taskId: '01994bd8-0000-7000-8000-000000000001',
          requestKey: '01994bd8-0000-7000-8000-000000000002',
          points,
          reason: 'Render',
        }).success,
      ).toBe(false);
    },
  );
  it('rejects non-members and unassigned tasks', async () => {
    const f = fixture();
    f.authorization.resolve.mockResolvedValueOnce(null);
    await expect(
      f.service.create('crew', 'creator', f.request),
    ).rejects.toThrow('membership');
    f.tx.crewTask.findFirst.mockResolvedValueOnce(null);
    await expect(
      f.service.create('crew', 'creator', f.request),
    ).rejects.toThrow('assigned');
    expect(f.tx.crewComputeRequest.create).not.toHaveBeenCalled();
  });
  it('replays an identical submission without another request', async () => {
    const f = fixture();
    f.tx.crewComputeRequest.findUnique.mockResolvedValue(f.request);
    await expect(
      f.service.create('crew', 'creator', f.request),
    ).resolves.toEqual(f.request);
    expect(f.tx.crewComputeRequest.create).not.toHaveBeenCalled();
    await expect(
      f.service.create('crew', 'creator', { ...f.request, points: 90 }),
    ).rejects.toThrow('different details');
  });
  it('snapshots the task and workspace and locks admission before creating', async () => {
    const f = fixture(false);
    await f.service.create('crew', 'creator', f.request);
    expect(f.tx.crewComputeRequest.create).toHaveBeenCalledWith({
      data: contains({
        taskTitle: 'Shot',
        workspaceId: 'workspace',
        userId: 'creator',
      }),
    });
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(2);
  });
  it('requires an active privileged Admin, not a Crew role', async () => {
    const f = fixture(false);
    await expect(
      f.service.decideAdmin(
        'crew',
        'request',
        { ...admin, permissions: [] },
        {
          status: 'approved',
          note: '',
        },
      ),
    ).rejects.toThrow('算力审批');
    expect(f.tx.crewComputeRequest.update).not.toHaveBeenCalled();
  });
  it('lets super_admin review with crew.compute.review', async () => {
    const f = fixture();
    await f.service.listAdmin({ ...admin, roleKeys: ['super_admin'] }, {});
    expect(f.tx.crewComputeRequest.findMany).toHaveBeenCalled();
  });

  it('rejects inactive Admins before reading or changing requests', async () => {
    const f = fixture();
    await expect(
      f.service.decideAdmin(
        'crew',
        'request',
        { ...admin, status: 'disabled' },
        { status: 'approved', note: '' },
      ),
    ).rejects.toThrow('算力审批');
    expect(f.tx.crewComputeRequest.findFirst).not.toHaveBeenCalled();
    expect(f.tx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('approves once and rejects conflicting decisions', async () => {
    const f = fixture();
    const input = { status: 'approved' as const, note: 'Render next shot' };
    await f.service.decideAdmin('crew', 'request', admin, input);
    await f.service.decideAdmin('crew', 'request', admin, input);
    expect(f.tx.crewComputeRequest.update).toHaveBeenCalledTimes(1);
    expect(f.tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
    expect(f.request).toMatchObject({
      status: 'approved',
      decidedByAdminId: 'admin',
      decidedByUserId: null,
    });
    await expect(
      f.service.decideAdmin('crew', 'request', admin, {
        status: 'rejected',
        note: '',
      }),
    ).rejects.toThrow('already been decided');
  });
  it('rechecks assignment and workspace balance before approval', async () => {
    const f = fixture();
    f.tx.crewTask.findFirst.mockResolvedValueOnce(null);
    await expect(
      f.service.decideAdmin('crew', 'request', admin, {
        status: 'approved',
        note: '',
      }),
    ).rejects.toThrow('assigned');
    f.tx.walletAccount.findUnique.mockResolvedValueOnce({
      id: 'wallet',
      status: 'active',
      availableBalance: 1n,
    });
    await expect(
      f.service.decideAdmin('crew', 'request', admin, {
        status: 'approved',
        note: '',
      }),
    ).rejects.toThrow('insufficient');
    expect(f.tx.crewComputeRequest.update).not.toHaveBeenCalled();
  });
  it('allows rejection after an assignment is removed', async () => {
    const f = fixture();
    f.tx.crewTask.findFirst.mockResolvedValue(null);
    await expect(
      f.service.decideAdmin('crew', 'request', admin, {
        status: 'rejected',
        note: 'Task reassigned',
      }),
    ).resolves.toMatchObject({
      status: 'rejected',
      decisionNote: 'Task reassigned',
    });
  });
  it('scopes member requests and consumption to the caller', async () => {
    const f = fixture(false);
    const data = await f.service.list('crew', 'creator');
    expect(data.consumedPoints).toBe('25');
    expect(f.tx.crewComputeRequest.findMany).toHaveBeenCalledWith(
      contains({ where: { crewId: 'crew', userId: 'creator' } }),
    );
    expect(f.tx.walletLedgerEntry.aggregate).toHaveBeenCalledWith(
      contains({
        where: contains({
          entryType: 'settle',
          transaction: contains({ actorUserId: 'creator' }),
        }),
      }),
    );
  });
});

it('requires a configured project and rejects aggregate task allowances beyond released stages', async () => {
  const f = fixture();
  f.tx.$queryRaw.mockResolvedValueOnce([]);
  await expect(
    f.service.decideAdmin('crew', 'request', admin, {
      status: 'approved',
      note: 'Review',
    }),
  ).rejects.toThrow('Configure');
  f.tx.crewComputeRequest.aggregate.mockResolvedValueOnce({
    _sum: { points: 75 },
  });
  await expect(
    f.service.decideAdmin('crew', 'request', admin, {
      status: 'approved',
      note: 'Review',
    }),
  ).rejects.toThrow('exceed released');
  expect(f.tx.crewComputeRequest.update).not.toHaveBeenCalled();
});

describe('task allowance admission', () => {
  function allowance(status = 'approved', delta = -20n) {
    const task = {
      id: 'task',
      deletedAt: null,
      crew: { workspaceId: 'workspace', deletedAt: null },
      assignees: [{ userId: 'creator' }],
      computeRequests: [
        {
          userId: 'creator',
          workspaceId: 'workspace',
          points: 50,
          status,
          createdAt: new Date('2026-09-28T00:00:00Z'),
        },
      ],
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      crewTask: { findUnique: jest.fn().mockResolvedValue(task) },
      walletTransaction: {
        findMany: jest.fn().mockResolvedValue([{ sourceId: 'job' }]),
      },
      walletLedgerEntry: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { availableDelta: delta } }),
      },
    };
    const input = {
      projectId: 'project',
      workspaceId: 'workspace',
      userId: 'creator',
      amount: 30n,
    };
    return { tx, task, input };
  }
  it('counts active holds and rejects spending above the approved cap', async () => {
    const f = allowance();
    await expect(
      requireCrewComputeAllowance(f.tx as never, f.input),
    ).resolves.toBe(true);
    await expect(
      requireCrewComputeAllowance(f.tx as never, { ...f.input, amount: 31n }),
    ).rejects.toThrow('allowance exceeded');
  });
  it('a released hold restores allowance and pending requests grant nothing', async () => {
    const released = allowance('approved', 0n);
    await expect(
      requireCrewComputeAllowance(released.tx as never, {
        ...released.input,
        amount: 50n,
      }),
    ).resolves.toBe(true);
    const pending = allowance('pending', 0n);
    await expect(
      requireCrewComputeAllowance(pending.tx as never, pending.input),
    ).rejects.toThrow('allowance exceeded');
  });
  it('rejects removed assignees and a different payer workspace', async () => {
    const f = allowance();
    await expect(
      requireCrewComputeAllowance(f.tx as never, {
        ...f.input,
        workspaceId: 'other',
      }),
    ).rejects.toThrow('linked Crew');
    f.task.assignees = [];
    await expect(
      requireCrewComputeAllowance(f.tx as never, f.input),
    ).rejects.toThrow('active assignment');
  });
  it('only counts jobs admitted after the first request, excluding old-job releases', async () => {
    const f = allowance();
    await requireCrewComputeAllowance(f.tx as never, f.input);
    expect(f.tx.walletTransaction.findMany).toHaveBeenCalledWith(
      contains({
        where: contains({
          metadata: { path: ['crewComputeAllowance'], equals: true },
          idempotencyKey: { startsWith: 'ai_job:hold:' },
        }),
      }),
    );
    expect(f.tx.walletLedgerEntry.aggregate).toHaveBeenCalledWith(
      contains({
        where: contains({
          transaction: { sourceType: 'ai_job', sourceId: { in: ['job'] } },
        }),
      }),
    );
  });
});
