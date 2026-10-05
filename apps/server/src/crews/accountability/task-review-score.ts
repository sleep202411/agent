import { approvedSubmissionTimeliness } from '../tasks/task-timeliness';

type Ratings =
  | {
      direction: 'creator';
      productionAbility: number;
      understanding: number;
      communication: number;
    }
  | { direction: 'manager'; managementAbility: number };
/** Snapshot from the approved submission; never use a task's mutable current deadline. */
export function taskReviewScore(
  ratings: Ratings,
  submission: { createdAt: Date; timelinessEvidence?: unknown },
) {
  const evidence =
    ratings.direction === 'creator'
      ? approvedSubmissionTimeliness(
          submission.createdAt,
          submission.timelinessEvidence,
        )
      : null;
  const timelinessScore = evidence ? (evidence.points > 0 ? 5 : 3) : null;
  const values =
    ratings.direction === 'creator'
      ? [
          ratings.productionAbility,
          ratings.understanding,
          ratings.communication,
        ]
      : [ratings.managementAbility];
  if (timelinessScore !== null) values.push(timelinessScore);
  return {
    scoreMilli: Math.round(
      (values.reduce((sum, value) => sum + value, 0) * 1000) / values.length,
    ),
    timelinessScore,
  };
}
