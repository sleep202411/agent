import type { Prisma } from '@prisma/client';

/** Serialize allocation and reversal before either reads the member's balance. */
export async function lockMemberPayouts(
  tx: Prisma.TransactionClient,
  crewId: string,
  userId: string,
) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`crew:payout-member:${crewId}:${userId}`})::bigint)
  `;
}
