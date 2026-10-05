import { taskReviewScore } from './task-review-score';
const ratings = {
  direction: 'creator' as const,
  productionAbility: 4,
  understanding: 5,
  communication: 3,
};
const deadline = '2026-10-01T12:00:00.000Z';
it('includes on-time and late delivery from the immutable submission evidence', () => {
  expect(
    taskReviewScore(ratings, {
      createdAt: new Date(deadline),
      timelinessEvidence: { version: 1, deadline },
    }),
  ).toEqual({ scoreMilli: 4250, timelinessScore: 5 });
  expect(
    taskReviewScore(ratings, {
      createdAt: new Date('2026-10-01T12:00:00.001Z'),
      timelinessEvidence: { version: 1, deadline },
    }),
  ).toEqual({ scoreMilli: 3750, timelinessScore: 3 });
});
it('does not invent timeliness for unmeasured submissions or producer response time', () => {
  expect(taskReviewScore(ratings, { createdAt: new Date(deadline) })).toEqual({
    scoreMilli: 4000,
    timelinessScore: null,
  });
  expect(
    taskReviewScore(
      { direction: 'manager', managementAbility: 2 },
      {
        createdAt: new Date(deadline),
        timelinessEvidence: { version: 1, deadline },
      },
    ),
  ).toEqual({ scoreMilli: 2000, timelinessScore: null });
});
