import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import {
  CrewTaskFeedbackAppealsService,
  TaskFeedbackAppealInput,
} from './task-feedback-appeals';
import { OpenDispute } from '../tasks/task-disputes';

it('rejects caller-selected respondents and oversized appeal reasons', () => {
  const input = { id: randomUUID(), reason: 'Review this feedback.' };
  expect(
    TaskFeedbackAppealInput.safeParse({ ...input, respondentUserId: 'other' })
      .success,
  ).toBe(false);
  expect(
    TaskFeedbackAppealInput.safeParse({ ...input, reason: 'x'.repeat(1001) })
      .success,
  ).toBe(false);
});
it('uses stored evidence and fits the dispute contract at maximum permitted input lengths', async () => {
  const row = {
    id: randomUUID(),
    taskId: randomUUID(),
    submissionId: randomUUID(),
    authorUserId: 'reviewer',
    subjectUserId: 'creator',
    direction: 'creator',
    ratings: {
      direction: 'creator',
      productionAbility: 1,
      understanding: 2,
      communication: 3,
    },
    comment: 'x'.repeat(2000),
    response: null,
  };
  const db = {
    crewTaskFeedback: { findFirst: jest.fn().mockResolvedValue(row) },
  };
  const disputes = {
    open: jest
      .fn<Promise<{ id: string }>, [string, string, unknown]>()
      .mockResolvedValue({ id: 'case' }),
  };
  const service = new CrewTaskFeedbackAppealsService(
    db as never,
    disputes as never,
  );
  const input = { id: randomUUID(), reason: 'y'.repeat(1000) };
  await service.open(row.id, 'creator', input);
  const captured: unknown = disputes.open.mock.calls[0][2];
  expect(OpenDispute.parse(captured)).toMatchObject({
    respondentUserId: 'reviewer',
    submissionIds: [row.submissionId],
  });
  expect(db.crewTaskFeedback.findFirst).toHaveBeenCalledWith({
    where: { id: row.id, subjectUserId: 'creator' },
  });
});
it('does not create a case for an inaccessible or missing review', async () => {
  const disputes = { open: jest.fn() };
  const service = new CrewTaskFeedbackAppealsService(
    {
      crewTaskFeedback: { findFirst: jest.fn().mockResolvedValue(null) },
    } as never,
    disputes as never,
  );
  await expect(
    service.open(randomUUID(), 'outsider', {
      id: randomUUID(),
      reason: 'Review it.',
    }),
  ).rejects.toBeInstanceOf(NotFoundException);
  expect(disputes.open).not.toHaveBeenCalled();
});
