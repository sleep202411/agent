import type { Prisma } from '@prisma/client';
/** Persist once at submission; historical rows remain unmeasured. */
export async function captureTaskTimelinessTx(
  tx: Prisma.TransactionClient,
  submissionId: string,
  deadline: Date | null,
  assignees: readonly { userId: string }[],
) {
  const evidence = JSON.stringify({
    version: 1,
    deadline: deadline?.toISOString() ?? null,
    assigneeUserIds: [...new Set(assignees.map((item) => item.userId))].sort(),
  });
  await tx.$executeRaw`
    UPDATE crew_task_submissions SET timeliness_evidence = ${evidence}::jsonb
    WHERE id = ${submissionId}::uuid AND timeliness_evidence IS NULL
  `;
}

/** A calculation for an approved submission, not a wallet or posting command. */
export function approvedSubmissionTimeliness(
  submittedAt: Date,
  evidence: unknown,
): { points: 200 | -200; deadline: string } | null {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence))
    return null;
  const row = evidence as Record<string, unknown>;
  if (row.version !== 1 || typeof row.deadline !== 'string') return null;
  const deadline = new Date(row.deadline);
  if (
    !Number.isFinite(deadline.getTime()) ||
    !Number.isFinite(submittedAt.getTime())
  )
    return null;
  return {
    points: submittedAt <= deadline ? 200 : -200,
    deadline: deadline.toISOString(),
  };
}

export async function recordApprovedTaskTimelinessTx(
  tx: Prisma.TransactionClient,
  submissionId: string,
  reviewerId: string,
) {
  const [submission] = await tx.$queryRaw<
    { createdAt: Date; evidence: unknown }[]
  >`
    SELECT created_at AS "createdAt", timeliness_evidence AS evidence
    FROM crew_task_submissions WHERE id = ${submissionId}::uuid
  `;
  if (!submission) return;
  const result = approvedSubmissionTimeliness(
    submission.createdAt,
    submission.evidence,
  );
  if (!result) return;
  await tx.$executeRaw`
    UPDATE crew_task_submissions SET timeliness_result = ${JSON.stringify({ ...result, reviewerId })}::jsonb
    WHERE id = ${submissionId}::uuid AND timeliness_result IS NULL
  `;
}
