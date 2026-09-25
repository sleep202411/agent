import { ReviewCrewTaskSchema } from '../dto';
import { revisionDeadline, taskDeadlineRisk } from './task-deadline';
const now = new Date('2026-09-24T08:00:00Z');
const past = new Date('2026-09-23T08:00:00Z');

it('separates creator lateness from completed work and time awaiting review', () => {
  expect(taskDeadlineRisk('in_progress', past, now)).toEqual({
    dueAt: past.toISOString(),
    overdue: true,
  });
  for (const status of ['submitted', 'approved', 'cancelled'])
    expect(taskDeadlineRisk(status, past, now)).toBeNull();
  expect(taskDeadlineRisk('open', null, now)).toBeNull();
  expect(taskDeadlineRisk('revision_requested', now, now)?.overdue).toBe(false);
});
it('accepts a later revision deadline and rejects shortening, invalid dates and dates in the past', () => {
  expect(
    revisionDeadline(now, '2026-09-25T16:00:00+08:00', now)?.toISOString(),
  ).toBe('2026-09-25T08:00:00.000Z');
  for (const requested of ['not-a-date', now.toISOString(), past.toISOString()])
    expect(() => revisionDeadline(now, requested, now)).toThrow();
  expect(() =>
    revisionDeadline(
      new Date('2026-09-27T00:00:00Z'),
      '2026-09-26T00:00:00Z',
      now,
    ),
  ).toThrow();
  expect(revisionDeadline(now, undefined, now)).toBeUndefined();
});
it('allows deadline extension only alongside a reasoned revision request', () => {
  const base = {
    expectedSubmissionId: '00000000-0000-4000-8000-000000000001',
    revisionDueAt: '2026-09-25T00:00:00Z',
  };
  expect(
    ReviewCrewTaskSchema.safeParse({ ...base, decision: 'approve' }).success,
  ).toBe(false);
  expect(
    ReviewCrewTaskSchema.safeParse({ ...base, decision: 'request_revision' })
      .success,
  ).toBe(false);
  expect(
    ReviewCrewTaskSchema.safeParse({
      ...base,
      decision: 'request_revision',
      note: 'Please supply the source audio.',
    }).success,
  ).toBe(true);
});
