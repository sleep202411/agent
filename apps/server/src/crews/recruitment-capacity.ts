import type { Prisma } from '@prisma/client';

/** Release occupied recruitment slots without losing concurrent approvals/removals. */
export async function releaseRecruitedPositions(
  tx: Prisma.TransactionClient,
  crewId: string,
  positionIds: Array<string | null>,
) {
  for (const positionId of [
    ...new Set(positionIds.filter((id): id is string => id !== null)),
  ].sort()) {
    await tx.$executeRaw`
      UPDATE crew_positions
      SET recruited_count = GREATEST(0, recruited_count - 1),
          status = CASE
            WHEN status = 'full' AND GREATEST(0, recruited_count - 1) < target_count THEN 'open'
            ELSE status
          END
      WHERE id = ${positionId} AND crew_id = ${crewId}
    `;
  }
}
