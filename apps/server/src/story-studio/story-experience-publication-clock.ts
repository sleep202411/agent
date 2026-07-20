import type { Prisma } from '@prisma/client';

/**
 * Lifecycle timestamps are compared by PostgreSQL constraints and leases.
 * Always source them from the database so multiple Nest hosts share one clock.
 *
 * Prisma maps TIMESTAMPTZ(6) to millisecond-precision JS Dates. Advancing one
 * millisecond after truncation keeps the round-tripped value strictly newer
 * than transaction-start defaults such as created_at.
 */
export async function storyExperiencePublicationClock(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
): Promise<Date> {
  const [clock] = await client.$queryRaw<Array<{ now: Date }>>`
    SELECT date_trunc('milliseconds', clock_timestamp())
      + interval '1 millisecond' AS "now"
  `;
  if (!(clock?.now instanceof Date) || !Number.isFinite(clock.now.getTime())) {
    throw new Error('Database clock query returned an invalid timestamp.');
  }
  return clock.now;
}
