import type { Prisma } from '@prisma/client';
import {
  claimTaskInviteTarget,
  lockTaskInviteTarget,
} from './task-invite-claim';

function harness() {
  const task = {
    id: 'task',
    crewId: 'crew',
    version: 3,
    assignees: [],
    workflowState: { semantic: 'todo' },
    canvasProjectId: 'canvas',
    metadata: { compensation: { rewardUsdMinor: 12500 } },
  };
  const db = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([]),
    crewTask: {
      findFirst: jest.fn().mockResolvedValue(task),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    crewMember: { findFirst: jest.fn().mockResolvedValue({ id: 'member' }) },
    crewPosition: { findMany: jest.fn().mockResolvedValue([]) },
    crewApplication: { findMany: jest.fn().mockResolvedValue([]) },
    crewTaskAssignee: { create: jest.fn().mockResolvedValue({}) },
    projectMember: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    crewAuthorizationEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const tx = db as unknown as Prisma.TransactionClient;
  const claim = async () =>
    claimTaskInviteTarget(
      tx,
      await lockTaskInviteTarget(tx, 'crew', 'task', 3),
      'member',
      'user',
      'producer',
      'link',
    );
  return { db, task, tx, claim };
}

describe('task invitation claim safeguards', () => {
  it('rejects a deleted or foreign-Crew target', async () => {
    const { db, claim } = harness();
    db.crewTask.findFirst.mockResolvedValue(null);
    await expect(claim()).rejects.toThrow('no longer available');
    expect(db.crewTaskAssignee.create).not.toHaveBeenCalled();
  });
  it('does not accept an offer after its version changed', async () => {
    const { task, claim, db } = harness();
    task.version = 4;
    await expect(claim()).rejects.toThrow('task changed');
    expect(db.crewTask.updateMany).not.toHaveBeenCalled();
  });
  it.each(['submitted', 'approved', 'cancelled'])(
    'rejects %s tasks',
    async (semantic) => {
      const { task, claim } = harness();
      task.workflowState.semantic = semantic;
      await expect(claim()).rejects.toThrow('no longer accepting');
    },
  );
  it('rejects a task already assigned to someone else', async () => {
    const { db, task, claim } = harness();
    db.crewTask.findFirst.mockResolvedValue({
      ...task,
      assignees: [{ userId: 'other' }],
    });
    await expect(claim()).rejects.toThrow('already assigned');
  });
  it('rejects revoked membership before assigning or granting canvas access', async () => {
    const { db, claim } = harness();
    db.crewMember.findFirst.mockResolvedValue(null);
    await expect(claim()).rejects.toThrow('active Crew membership');
    expect(db.crewTask.updateMany).not.toHaveBeenCalled();
    expect(db.projectMember.create).not.toHaveBeenCalled();
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid compensation %s',
    async (reward) => {
      const { task, claim, db } = harness();
      task.metadata.compensation.rewardUsdMinor = reward;
      await expect(claim()).rejects.toThrow('compensation is incomplete');
      expect(db.crewTaskAssignee.create).not.toHaveBeenCalled();
    },
  );
  it.each(['monthly', 'half_upfront', 'on_completion', 'demo_promise'])(
    'records accepted %s terms independently of subsequent task metadata',
    async (paymentTerms) => {
      const { db, task, claim } = harness();
      Object.assign(task.metadata.compensation, {
        paymentTerms,
        profitShareBps: 250,
      });
      await claim();
      Object.assign(task.metadata.compensation, {
        paymentTerms: 'monthly',
        rewardUsdMinor: 900,
      });
      expect(db.crewAuthorizationEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          after: expect.objectContaining({
            taskVersion: 3,
            compensation: {
              currency: 'USD',
              rewardAmountMinor: 12500,
              paymentTerms,
              profitShareBps: 250,
            },
          }) as unknown,
        }) as unknown,
      });
    },
  );
  it('rejects unrecognized payment terms before mutating assignment', async () => {
    const { db, task, claim } = harness();
    Object.assign(task.metadata.compensation, { paymentTerms: 'whenever' });
    await expect(claim()).rejects.toThrow('compensation is incomplete');
    expect(db.crewTask.updateMany).not.toHaveBeenCalled();
    expect(db.crewAuthorizationEvent.create).not.toHaveBeenCalled();
  });
  it('preserves existing recruitment approval and compensation requirements', async () => {
    const { db, claim } = harness();
    db.crewPosition.findMany.mockResolvedValue([{ id: 'posting' }]);
    await expect(claim()).rejects.toThrow('approved recruitment and confirmed');
    expect(db.crewTask.updateMany).not.toHaveBeenCalled();
  });
  it('fails before access grants if the conditional assignment loses', async () => {
    const { db, claim } = harness();
    db.crewTask.updateMany.mockResolvedValue({ count: 0 });
    await expect(claim()).rejects.toThrow('before it could be claimed');
    expect(db.crewTaskAssignee.create).not.toHaveBeenCalled();
    expect(db.projectMember.create).not.toHaveBeenCalled();
    expect(db.crewAuthorizationEvent.create).not.toHaveBeenCalled();
  });
  it('records the agreed reward and grants access for the claimed task', async () => {
    const { db, claim } = harness();
    await claim();
    expect(db.crewTaskAssignee.create).toHaveBeenCalledWith({
      data: {
        crewId: 'crew',
        crewMemberId: 'member',
        userId: 'user',
        taskId: 'task',
        rewardAmountMinor: 12500n,
        currency: 'USD',
      },
    });
    expect(db.projectMember.create).toHaveBeenCalledWith({
      data: {
        grantedById: 'producer',
        projectId: 'canvas',
        userId: 'user',
        role: 'editor',
        status: 'active',
      },
    });
    expect(db.crewAuthorizationEvent.create).toHaveBeenCalledTimes(1);
  });
});
