import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  CrewTaskFeedbackService,
  TaskFeedbackPageInput,
  TaskFeedbackInput,
} from './task-feedback';

function fixture() {
  const current = {
    workflowState: { semantic: 'approved' },
    submissions: [
      {
        id: 'submission',
        submittedByUserId: 'creator',
        reviewedByUserId: 'manager',
        reviewedAt: new Date(),
      },
    ],
  };
  const tx = {
    $executeRaw: jest.fn(),
    crewTask: { findFirst: jest.fn().mockResolvedValue(current) },
    crewTaskFeedback: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: unknown }) =>
          Promise.resolve(data),
        ),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: unknown }) =>
          Promise.resolve(data),
        ),
    },
  };
  const db = {
    ...tx,
    crewTask: { findFirst: jest.fn().mockResolvedValue({ crewId: 'crew' }) },
    $transaction: (fn: (tx: unknown) => unknown) => Promise.resolve(fn(tx)),
  };
  const auth = { require: jest.fn() };
  return {
    tx,
    current,
    auth,
    service: new CrewTaskFeedbackService(db as never, auth as never),
  };
}
const review = {
  subjectUserId: 'creator',
  ratings: {
    direction: 'creator' as const,
    productionAbility: 4,
    understanding: 5,
    communication: 3,
  },
  comment: 'Delivered agreed work.',
};
describe('task feedback authorization and evidence', () => {
  it('records only the actual reviewer and submitter, with submission evidence', async () => {
    const f = fixture();
    expect(await f.service.submit('task', 'manager', review)).toMatchObject({
      taskId: 'task',
      submissionId: 'submission',
      authorUserId: 'manager',
      subjectUserId: 'creator',
    });
    await expect(
      f.service.submit('task', 'bystander', review),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      f.service.submit('task', 'creator', review),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.crewTaskFeedback.create).toHaveBeenCalledTimes(1);
  });
  it('does not allow feedback on incomplete work or without review evidence', async () => {
    const f = fixture();
    f.current.workflowState.semantic = 'submitted';
    await expect(
      f.service.submit('task', 'manager', review),
    ).rejects.toBeInstanceOf(ConflictException);
    f.current.workflowState.semantic = 'approved';
    f.current.submissions = [];
    await expect(
      f.service.submit('task', 'manager', review),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('accepts matching retries and rejects overwriting a submitted review', async () => {
    const f = fixture();
    f.tx.crewTaskFeedback.findUnique.mockResolvedValue({
      ...review,
      id: 'feedback',
    } as never);
    expect(await f.service.submit('task', 'manager', review)).toMatchObject({
      id: 'feedback',
    });
    await expect(
      f.service.submit('task', 'manager', {
        ...review,
        comment: 'Changed my mind.',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.crewTaskFeedback.create).not.toHaveBeenCalled();
  });
  it('supports the creator reviewing the actual manager with the correct dimensions', async () => {
    const f = fixture();
    expect(
      await f.service.submit('task', 'creator', {
        subjectUserId: 'manager',
        ratings: { direction: 'manager', managementAbility: 4 },
        comment: 'Clear instructions.',
      }),
    ).toMatchObject({ direction: 'manager' });
    await expect(
      f.service.submit('task', 'manager', {
        ...review,
        ratings: { direction: 'manager', managementAbility: 4 },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('scopes responses to the subject and allows one immutable response', async () => {
    const f = fixture();
    await expect(
      f.service.respond('feedback', 'bystander', {
        response: 'Not my review.',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.tx.crewTaskFeedback.findFirst).toHaveBeenCalledWith({
      where: { id: 'feedback', subjectUserId: 'bystander' },
    });
    f.tx.crewTaskFeedback.findFirst.mockResolvedValue({
      response: null,
    } as never);
    await f.service.respond('feedback', 'creator', {
      response: 'Thank you for the feedback.',
    });
    f.tx.crewTaskFeedback.findFirst.mockResolvedValue({
      response: 'Thank you for the feedback.',
    } as never);
    await f.service.respond('feedback', 'creator', {
      response: 'Thank you for the feedback.',
    });
    await expect(
      f.service.respond('feedback', 'creator', {
        response: 'A different response.',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.crewTaskFeedback.update).toHaveBeenCalledTimes(1);
  });
});

describe('private task feedback history', () => {
  it('rejects attempts to select another participant or broaden the scope', () => {
    for (const extra of [{ userId: 'other' }, { scope: 'crew' }])
      expect(TaskFeedbackPageInput.safeParse(extra).success).toBe(false);
  });
  it('paginates only participant rows without requiring current membership', async () => {
    const f = fixture();
    f.auth.require.mockRejectedValue(new ForbiddenException());
    f.tx.crewTaskFeedback.findMany.mockResolvedValue([
      { id: 'first' },
      { id: 'next' },
    ]);
    expect(await f.service.listMine('creator', { limit: 1 })).toEqual({
      items: [{ id: 'first' }],
      nextCursor: 'first',
    });
    expect(f.tx.crewTaskFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ authorUserId: 'creator' }, { subjectUserId: 'creator' }],
        },
        take: 2,
      }),
    );
    expect(f.auth.require).not.toHaveBeenCalled();
  });
  it('rejects a cursor outside the participant scope before reading a page', async () => {
    const f = fixture();
    await expect(
      f.service.listMine('creator', { limit: 20, cursor: 'foreign' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.tx.crewTaskFeedback.findMany).not.toHaveBeenCalled();
  });
});

describe('optional task review comments', () => {
  it('accepts omitted, blank and short comments while requiring valid ratings', async () => {
    const ratingOnly = {
      subjectUserId: review.subjectUserId,
      ratings: review.ratings,
    };
    expect(TaskFeedbackInput.parse(ratingOnly).comment).toBe('');
    const f = fixture();
    for (const comment of ['', '  ', 'OK']) {
      expect(
        await f.service.submit('task', 'manager', { ...review, comment }),
      ).toMatchObject({ comment: comment.trim(), ratings: review.ratings });
    }
    expect(
      TaskFeedbackInput.safeParse({ ...review, comment: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
    expect(
      TaskFeedbackInput.safeParse({
        ...ratingOnly,
        ratings: { ...review.ratings, communication: 0 },
      }).success,
    ).toBe(false);
  });
  it('replays an empty-comment review and rejects a later added comment', async () => {
    const f = fixture();
    const input = { ...review, comment: '' };
    f.tx.crewTaskFeedback.findUnique.mockResolvedValue({
      ...input,
      id: 'feedback',
    } as never);
    expect(await f.service.submit('task', 'manager', input)).toMatchObject({
      id: 'feedback',
    });
    await expect(
      f.service.submit('task', 'manager', { ...input, comment: 'Added later' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.crewTaskFeedback.create).not.toHaveBeenCalled();
  });
});
