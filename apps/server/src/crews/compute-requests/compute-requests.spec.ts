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
    remainingWorkload: 10,
    workloadUnit: 'minutes' as const,
    kind: 'top_up',
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
    crew: {
      findUnique: jest.fn().mockResolvedValue({ workspaceId: 'workspace' }),
    },
    crewTask: {
      findFirst: jest.fn().mockResolvedValue(task),
      findMany: jest.fn().mockResolvedValue([]),
    },
    crewComputeRequest: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { points: 0 } }),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string } }) =>
          Promise.resolve(where.id ? { ...request } : null),
        ),
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
  const collaboration = {
    ensureCrewSpace: jest.fn().mockResolvedValue({ workspaceId: 'workspace' }),
    ensureCrewSpaceTx: jest
      .fn()
      .mockResolvedValue({ workspaceId: 'workspace' }),
  };
  const walletLedger = {
    ensureDefaultAccounts: jest.fn().mockResolvedValue([]),
    postEntryTx: jest.fn().mockResolvedValue({}),
  };
  const service = new CrewComputeRequestsService(
    prisma as never,
    authorization as never,
    collaboration as never,
    walletLedger as never,
  );
  return { service, tx, authorization, request, collaboration, walletLedger };
}

describe('Crew compute requests', () => {
  it('only allows the owner to explicitly initialize the compute workspace', async () => {
    const f = fixture(false);
    await expect(f.service.setupWorkspace('crew', 'creator')).rejects.toThrow(
      'Only the project owner',
    );
    expect(f.collaboration.ensureCrewSpace).not.toHaveBeenCalled();
    f.authorization.resolve.mockResolvedValue({ isOwner: true });
    await expect(f.service.setupWorkspace('crew', 'owner')).resolves.toEqual({
      workspaceId: 'workspace',
    });
    expect(f.collaboration.ensureCrewSpace).toHaveBeenCalledWith(
      'crew',
      'owner',
    );
  });

  it('allows assigned creators to request up to 3000 points for themselves', async () => {
    const f = fixture(false);
    await expect(
      f.service.create('crew', 'creator', { ...f.request, points: 3000 }),
    ).resolves.toMatchObject({
      userId: 'creator',
      requestedByUserId: 'creator',
      points: 3000,
    });
    expect(f.tx.crewTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: contains({ assignees: { some: { userId: 'creator' } } }),
      }),
    );
  });
  it.each([true, false])(
    'rejects requesting points for another creator, owner=%s',
    async (owner) => {
      const f = fixture(owner);
      await expect(
        f.service.create('crew', 'owner', {
          ...f.request,
          beneficiaryUserId: 'creator',
        }),
      ).rejects.toThrow('themselves');
      expect(f.tx.crewComputeRequest.create).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, 3001, 2_000_000_001])(
    'rejects invalid points %s',
    (points) => {
      expect(
        CreateComputeRequestSchema.safeParse({
          taskId: '01994bd8-0000-7000-8000-000000000001',
          requestKey: '01994bd8-0000-7000-8000-000000000002',
          points,
          reason: 'Render',
          remainingWorkload: 10,
          workloadUnit: 'minutes',
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
  it('snapshots the requesting creator and locks admission before creating', async () => {
    const f = fixture();
    await f.service.create('crew', 'creator', {
      ...f.request,
      beneficiaryUserId: 'creator',
    });
    expect(f.tx.crewComputeRequest.create).toHaveBeenCalledWith({
      data: contains({
        taskTitle: 'Shot',
        workspaceId: 'workspace',
        userId: 'creator',
        requestedByUserId: 'creator',
      }),
    });
    expect(
      f.tx.$executeRaw.mock.calls.map((call: unknown[]) => call[1]),
    ).toEqual([
      'crew:collaboration:crew',
      'crew:task-writes:crew',
      'wallet:account:wallet',
    ]);
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
    expect(f.walletLedger.postEntryTx).toHaveBeenCalledTimes(1);
    expect(f.walletLedger.postEntryTx).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({
        availableDelta: 50n,
        workspaceId: 'workspace',
        sourceId: 'request',
      }),
    );
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
  it('rechecks assignment and can credit an empty workspace wallet', async () => {
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
    ).resolves.toMatchObject({ status: 'approved' });
    expect(f.walletLedger.postEntryTx).toHaveBeenCalledTimes(1);
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
      cancelledAt: null as Date | null,
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
  it('does not let a task with no allowance spend the whole project budget', async () => {
    const f = allowance();
    f.task.computeRequests = [];
    await expect(
      requireCrewComputeAllowance(f.tx as never, f.input),
    ).rejects.toThrow('No task compute allowance');
  });
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
  it('prevents spending from a cancelled task despite an active assignment', async () => {
    const f = allowance();
    f.task.cancelledAt = new Date();
    await expect(
      requireCrewComputeAllowance(f.tx as never, f.input),
    ).rejects.toThrow('active assignment');
    expect(f.tx.walletTransaction.findMany).not.toHaveBeenCalled();
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

describe('top-up financial boundaries', () => {
  it('counts a rejected request by another recipient as the one application', async () => {
    const f = fixture();
    f.tx.crewComputeRequest.findFirst.mockResolvedValueOnce({
      ...f.request,
      userId: 'other',
      status: 'rejected',
    });
    await expect(f.service.create('crew', 'owner', f.request)).rejects.toThrow(
      'Only one top-up',
    );
    expect(f.tx.crewComputeRequest.create).not.toHaveBeenCalled();
  });
  it('rejects changed workload on an idempotent retry', async () => {
    const f = fixture();
    f.tx.crewComputeRequest.findUnique.mockResolvedValue(f.request);
    await expect(
      f.service.create('crew', 'owner', {
        ...f.request,
        remainingWorkload: 11,
      }),
    ).rejects.toThrow('different details');
  });
  it('rejects cancelled tasks on approval even when an assignment remains', async () => {
    const f = fixture();
    f.tx.crewTask.findFirst.mockResolvedValue({
      id: 'task',
      title: 'Shot',
      canvasProjectId: 'project',
      crew: { workspaceId: 'workspace' },
      cancelledAt: new Date(),
    } as never);
    await expect(
      f.service.decideAdmin('crew', 'request', admin, {
        status: 'approved',
        note: '',
      }),
    ).rejects.toThrow('non-cancelled');
    expect(f.walletLedger.postEntryTx).not.toHaveBeenCalled();
  });
  it('does not mark approval when posting the credit fails', async () => {
    const f = fixture();
    f.walletLedger.postEntryTx.mockRejectedValue(
      new Error('journal unavailable'),
    );
    await expect(
      f.service.decideAdmin('crew', 'request', admin, {
        status: 'approved',
        note: '',
      }),
    ).rejects.toThrow('journal unavailable');
    expect(f.tx.crewComputeRequest.update).not.toHaveBeenCalled();
  });
  it('never retroactively credits historical allowances', async () => {
    const f = fixture();
    f.request.kind = 'legacy_allowance';
    await f.service.decideAdmin('crew', 'request', admin, {
      status: 'approved',
      note: '',
    });
    expect(f.walletLedger.postEntryTx).not.toHaveBeenCalled();
  });
  it('validates the 3000-point boundary and percentage workload', () => {
    const value = {
      taskId: '01994bd8-0000-7000-8000-000000000001',
      requestKey: '01994bd8-0000-7000-8000-000000000002',
      points: 3000,
      reason: 'Render',
      remainingWorkload: 100,
      workloadUnit: 'percent',
    };
    expect(CreateComputeRequestSchema.safeParse(value).success).toBe(true);
    expect(
      CreateComputeRequestSchema.safeParse({ ...value, points: 3001 }).success,
    ).toBe(false);
    expect(
      CreateComputeRequestSchema.safeParse({ ...value, remainingWorkload: 101 })
        .success,
    ).toBe(false);
  });
});

describe('Points requests provision accounting without a separate setup step', () => {
  it('provisions for an assigned creator inside the request transaction without issuing points', async () => {
    const f = fixture(false);
    f.tx.crewTask.findFirst.mockResolvedValueOnce({
      id: 'task',
      title: 'Shot',
      canvasProjectId: 'project',
      crew: { workspaceId: null },
    } as never);
    await expect(
      f.service.create('crew', 'creator', f.request),
    ).resolves.toMatchObject({ status: 'pending', workspaceId: 'workspace' });
    expect(f.collaboration.ensureCrewSpaceTx).toHaveBeenCalledWith(
      'crew',
      f.tx,
    );
    expect(f.walletLedger.ensureDefaultAccounts).toHaveBeenCalledWith(
      'workspace',
      'workspace',
      f.tx,
    );
    expect(f.walletLedger.postEntryTx).not.toHaveBeenCalled();
    expect(f.collaboration.ensureCrewSpace).not.toHaveBeenCalled();
  });
  it('reuses existing accounting without provisioning another workspace', async () => {
    const f = fixture(false);
    await f.service.create('crew', 'creator', f.request);
    expect(f.collaboration.ensureCrewSpaceTx).not.toHaveBeenCalled();
  });
  it('does not provision for an unassigned creator', async () => {
    const f = fixture(false);
    f.tx.crewTask.findFirst.mockResolvedValue(null as never);
    await expect(
      f.service.create('crew', 'creator', f.request),
    ).rejects.toThrow('currently assigned');
    expect(f.collaboration.ensureCrewSpaceTx).not.toHaveBeenCalled();
    expect(f.walletLedger.ensureDefaultAccounts).not.toHaveBeenCalled();
  });
  it('does not provision for a duplicate top-up', async () => {
    const f = fixture(false);
    f.tx.crewTask.findFirst.mockResolvedValueOnce({
      id: 'task',
      title: 'Shot',
      canvasProjectId: 'project',
      crew: { workspaceId: null },
    } as never);
    f.tx.crewComputeRequest.findFirst.mockResolvedValue(f.request);
    await expect(
      f.service.create('crew', 'creator', f.request),
    ).rejects.toThrow('Only one top-up');
    expect(f.collaboration.ensureCrewSpaceTx).not.toHaveBeenCalled();
  });
});
