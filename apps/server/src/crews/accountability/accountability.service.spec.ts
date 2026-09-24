import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { CrewAccountabilityService } from './accountability.service';
import { CommitmentActionSchema, FeedbackSchema } from './accountability.dto';

const containing = (value: Record<string, unknown>): unknown =>
  expect.objectContaining(value);
const due = new Date('2099-01-02T12:00:00Z');
function fixture() {
  const task = {
    id: 'task',
    crewId: 'crew',
    title: 'Scene',
    createdByUserId: 'leader',
    version: 1,
    dueAt: due,
    workflowState: { semantic: 'in_progress' },
    assignees: [{ id: 'assignment', userId: 'creator' }],
  };
  const record = {
    id: 'commitment',
    taskId: 'task',
    assignmentId: 'assignment',
    userId: 'creator',
    status: 'accepted',
    acceptedAt: new Date(),
    promisedDueAt: due,
    reason: '',
    releasedAt: null,
    handoverNote: null,
    task,
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([]),
    crewTask: {
      findFirst: jest.fn().mockResolvedValue(task),
      update: jest.fn().mockResolvedValue(task),
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([]),
    },
    crewTaskCommitment: {
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(record),
      findFirst: jest.fn().mockResolvedValue(record),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(record),
      update: jest.fn().mockResolvedValue(record),
      count: jest.fn().mockResolvedValue(0),
    },
    crewParticipationRecord: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'participation' }),
      update: jest.fn(),
    },
    crewTaskTimelineItem: {
      create: jest.fn().mockResolvedValue({ id: 'event' }),
    },
    crewProductionPage: {
      findUnique: jest.fn().mockResolvedValue({ status: 'completed' }),
    },
    crewPeerFeedback: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'feedback' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
    crewOwnership: {
      findUnique: jest.fn().mockResolvedValue({ member: { userId: 'leader' } }),
    },
    walletAccount: { upsert: jest.fn().mockResolvedValue({ id: 'wallet' }) },
  };
  const db = {
    ...tx,
    $transaction: jest.fn(async (fn: (db: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const access = {
    isOwner: false,
    permissions: ['tasks.review', 'production.manage'],
  };
  const auth = {
    can: jest.fn().mockResolvedValue(true),
    require: jest.fn().mockResolvedValue(access),
    requireMembership: jest.fn().mockResolvedValue(access),
  };
  const ledger = { postEntryTx: jest.fn().mockResolvedValue({}) };
  const notifications = { send: jest.fn().mockResolvedValue({}) };
  const service = new CrewAccountabilityService(
    db as never,
    auth as never,
    notifications as never,
  );
  return { service, tx, auth, ledger, notifications, task, record };
}
const previousPoints = process.env.CREW_COMPLETION_REWARD_POINTS;
const previousApprovers = process.env.CREW_COMPLETION_REWARD_APPROVER_IDS;
afterEach(() => {
  if (previousPoints === undefined)
    delete process.env.CREW_COMPLETION_REWARD_POINTS;
  else process.env.CREW_COMPLETION_REWARD_POINTS = previousPoints;
  if (previousApprovers === undefined)
    delete process.env.CREW_COMPLETION_REWARD_APPROVER_IDS;
  else process.env.CREW_COMPLETION_REWARD_APPROVER_IDS = previousApprovers;
});
function rewards() {
  process.env.CREW_COMPLETION_REWARD_POINTS = '10';
  process.env.CREW_COMPLETION_REWARD_APPROVER_IDS = 'leader';
}

describe('Crew accountability', () => {
  it('does not mark a creator overdue while the submitted task awaits review', async () => {
    const f = fixture();
    f.task.workflowState.semantic = 'submitted';
    f.record.promisedDueAt = new Date('2000-01-01');
    f.tx.crewTaskCommitment.findMany.mockResolvedValue([f.record] as never);
    expect(
      (await f.service.taskCommitments('task', 'creator')).records[0]?.overdue,
    ).toBe(false);
  });

  it('validates reasons and feedback ratings before entering the service', () => {
    expect(
      CommitmentActionSchema.safeParse({
        action: 'withdraw',
        expectedVersion: 1,
        reason: ' ',
      }).success,
    ).toBe(false);
    expect(
      FeedbackSchema.safeParse({
        subjectUserId: 'a',
        rating: 6,
        comment: 'Example',
      }).success,
    ).toBe(false);
    expect(
      CommitmentActionSchema.safeParse({ action: 'accept', expectedVersion: 1 })
        .success,
    ).toBe(true);
  });
  it('snapshots the deadline, increments task version and notifies the leader atomically', async () => {
    const f = fixture();
    await f.service.commit('task', 'creator', {
      action: 'accept',
      expectedVersion: 1,
      reason: '',
    });
    expect(f.tx.crewTaskCommitment.upsert).toHaveBeenCalledWith(
      containing({
        create: containing({
          assignmentId: 'assignment',
          promisedDueAt: due,
          status: 'accepted',
        }),
      }),
    );
    expect(f.tx.crewTask.update).toHaveBeenCalledWith({
      where: { id: 'task' },
      data: { version: { increment: 1 } },
    });
    expect(f.notifications.send).toHaveBeenCalledWith(
      containing({ userId: 'leader' }),
      f.tx,
    );
  });
  it('does not notify a task creator whose Crew access was revoked', async () => {
    const f = fixture();
    f.task.createdByUserId = 'former-member';
    f.auth.can.mockImplementation((_crew, userId) =>
      Promise.resolve(userId !== 'former-member'),
    );
    await f.service.commit('task', 'creator', {
      action: 'accept',
      expectedVersion: 1,
      reason: '',
    });
    expect(f.notifications.send).toHaveBeenCalledTimes(1);
    expect(f.notifications.send).toHaveBeenCalledWith(
      containing({ userId: 'leader' }),
      f.tx,
    );
  });

  it('rechecks access after acquiring the assignment lock', async () => {
    const f = fixture();
    f.auth.requireMembership
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(
      f.service.commit('task', 'creator', {
        action: 'accept',
        expectedVersion: 1,
        reason: '',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.$executeRaw).toHaveBeenCalled();
    expect(f.tx.crewTaskCommitment.upsert).not.toHaveBeenCalled();
  });
  it.each(['approved', 'cancelled', 'submitted'])(
    'rejects commitment changes in %s tasks',
    async (status) => {
      const f = fixture();
      f.task.workflowState.semantic = status;
      await expect(
        f.service.commit('task', 'creator', {
          action: 'accept',
          expectedVersion: 1,
          reason: '',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );
  it('rejects a stale task version and unassigned callers', async () => {
    const f = fixture();
    await expect(
      f.service.commit('task', 'creator', {
        action: 'accept',
        expectedVersion: 2,
        reason: '',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      f.service.commit('task', 'stranger', {
        action: 'accept',
        expectedVersion: 1,
        reason: '',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('requires a future deadline for acceptance', async () => {
    const f = fixture();
    f.task.dueAt = new Date('2000-01-01');
    await expect(
      f.service.commit('task', 'creator', {
        action: 'accept',
        expectedVersion: 1,
        reason: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('distinguishes declining an invitation from abandoning an accepted commitment', async () => {
    const f = fixture();
    await f.service.commit('task', 'creator', {
      action: 'withdraw',
      expectedVersion: 1,
      reason: 'Unavailable this week',
    });
    expect(f.tx.crewTaskCommitment.upsert).toHaveBeenCalledWith(
      containing({
        create: containing({
          acceptedAt: null,
          promisedDueAt: null,
          status: 'withdrawn',
        }),
        update: { status: 'withdrawn', reason: 'Unavailable this week' },
      }),
    );
  });
  it('does not overwrite an accepted deadline when reporting a risk', async () => {
    const f = fixture();
    f.tx.crewTaskCommitment.findUnique.mockResolvedValue(f.record as never);
    await f.service.commit('task', 'creator', {
      action: 'at_risk',
      expectedVersion: 1,
      reason: 'Schedule conflict',
    });
    expect(f.tx.crewTaskCommitment.upsert).toHaveBeenCalledWith(
      containing({
        update: { status: 'at_risk', reason: 'Schedule conflict' },
      }),
    );
  });
  it('cannot rewrite a withdrawal as acceptance', async () => {
    const f = fixture();
    f.tx.crewTaskCommitment.findUnique.mockResolvedValue({
      ...f.record,
      status: 'withdrawn',
    } as never);
    await expect(
      f.service.commit('task', 'creator', {
        action: 'accept',
        expectedVersion: 1,
        reason: '',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('requires reassignment and an accepted replacement before closing handover', async () => {
    const f = fixture();
    f.tx.crewTaskCommitment.findUnique.mockResolvedValue(f.record as never);
    await expect(
      f.service.handover('commitment', 'leader', 'Files provided'),
    ).rejects.toBeInstanceOf(ConflictException);
    f.task.assignees = [];
    f.tx.crewTaskCommitment.findFirst.mockResolvedValue(null as never);
    await expect(
      f.service.handover('commitment', 'leader', 'Files provided'),
    ).rejects.toBeInstanceOf(ConflictException);
    f.task.assignees = [{ id: 'new', userId: 'replacement' }];
    f.tx.crewTaskCommitment.findFirst.mockResolvedValue({
      ...f.record,
      userId: 'replacement',
    });
    await f.service.handover('commitment', 'leader', 'Files provided');
    expect(f.tx.crewTaskCommitment.update).toHaveBeenCalledWith(
      containing({
        data: containing({ handoverNote: 'Files provided' }),
      }),
    );
  });
  it('allows closing cancelled work without inventing a replacement', async () => {
    const f = fixture();
    f.tx.crewTaskCommitment.findUnique.mockResolvedValue(f.record as never);
    f.task.workflowState.semantic = 'cancelled';
    await f.service.handover('commitment', 'leader', 'Project cancelled');
    expect(f.tx.crewTaskCommitment.findFirst).not.toHaveBeenCalled();
  });
  it('requires project completion and prevents self-review', async () => {
    const f = fixture();
    await expect(
      f.service.feedback('crew', 'creator', {
        subjectUserId: 'creator',
        rating: 5,
        comment: 'Great',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    f.tx.crewProductionPage.findUnique.mockResolvedValue({
      status: 'in_progress',
    });
    await expect(
      f.service.feedback('crew', 'creator', {
        subjectUserId: 'peer',
        rating: 5,
        comment: 'Great',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('requires real participation, not just membership, to review', async () => {
    const f = fixture();
    f.tx.crewTask.count.mockResolvedValue(0);
    await expect(
      f.service.feedback('crew', 'bystander', {
        subjectUserId: 'peer',
        rating: 5,
        comment: 'Great',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('deduplicates peer review retries and refuses to overwrite earlier feedback', async () => {
    const f = fixture();
    f.tx.crewPeerFeedback.findUnique.mockResolvedValue({
      rating: 4,
      comment: 'Delivered carefully',
    } as never);
    await f.service.feedback('crew', 'creator', {
      subjectUserId: 'peer',
      rating: 4,
      comment: 'Delivered carefully',
    });
    expect(f.tx.crewPeerFeedback.create).not.toHaveBeenCalled();
    await expect(
      f.service.feedback('crew', 'creator', {
        subjectUserId: 'peer',
        rating: 1,
        comment: 'Changed my mind',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it.each([true, false])(
    'handles overlapping feedback replies without overwriting the first (same=%s)',
    async (same) => {
      const f = fixture();
      const initial = {
        id: 'feedback',
        subjectUserId: 'creator',
        response: null,
        respondedAt: null,
      };
      const saved = {
        ...initial,
        response: 'My reply',
        respondedAt: new Date(),
      };
      // Both requests observe the unanswered row before either conditional write.
      let readers = 0;
      let release!: () => void;
      const readBarrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.tx.crewPeerFeedback.findUnique.mockImplementation(async () => {
        if (++readers === 2) release();
        await readBarrier;
        return initial;
      });
      f.tx.crewPeerFeedback.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      f.tx.crewPeerFeedback.findUniqueOrThrow.mockResolvedValue(saved);
      const results = await Promise.allSettled([
        f.service.respond('feedback', 'creator', 'My reply'),
        f.service.respond(
          'feedback',
          'creator',
          same ? 'My reply' : 'Changed reply',
        ),
      ]);
      expect(results[0]).toEqual({ status: 'fulfilled', value: saved });
      if (same)
        expect(results[1]).toEqual({ status: 'fulfilled', value: saved });
      else
        expect(results[1]).toMatchObject({
          status: 'rejected',
          reason: expect.any(ConflictException) as unknown,
        });
      expect(f.tx.crewPeerFeedback.updateMany).toHaveBeenCalledTimes(2);
      for (const [write] of f.tx.crewPeerFeedback.updateMany.mock
        .calls as unknown as [{ where: unknown }][]) {
        expect(write.where).toEqual({
          id: 'feedback',
          subjectUserId: 'creator',
          respondedAt: null,
        });
      }
    },
  );
  it('only permits the subject to respond', async () => {
    const f = fixture();
    f.tx.crewPeerFeedback.findUnique.mockResolvedValue({
      subjectUserId: 'creator',
    } as never);
    await expect(
      f.service.respond('feedback', 'stranger', 'My reply'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each([false, true])(
    'rejects community rewards even with legacy configuration: %s',
    async (configured) => {
      if (configured) rewards();
      else {
        delete process.env.CREW_COMPLETION_REWARD_POINTS;
        delete process.env.CREW_COMPLETION_REWARD_APPROVER_IDS;
      }
      const f = fixture();
      await expect(
        f.service.recognize('crew', 'creator', 'leader'),
      ).rejects.toThrow('Crew compensation is money and agreed profit sharing');
      expect(f.tx.walletAccount.upsert).not.toHaveBeenCalled();
      expect(f.ledger.postEntryTx).not.toHaveBeenCalled();
      expect(f.tx.crewParticipationRecord.upsert).not.toHaveBeenCalled();
    },
  );
});
