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

/** Same keys/order as individual member locks, without one round trip per member. */
export async function lockMembersPayouts(
  tx: Prisma.TransactionClient,
  crewId: string,
  userIds: string[],
) {
  const keys = [...new Set(userIds)]
    .sort()
    .map((userId) => `crew:payout-member:${crewId}:${userId}`);
  if (!keys.length) return;
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(key)::bigint)
    FROM unnest(${keys}::text[]) WITH ORDINALITY AS member_locks(key, position)
    ORDER BY position
  `;
}

/** A receipt key belongs to one request, even if its beneficiary changes. */
export async function lockLedgerReceipt(
  tx: Prisma.TransactionClient,
  key: string,
) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`crew:ledger-receipt:${key}`})::bigint)
  `;
}
