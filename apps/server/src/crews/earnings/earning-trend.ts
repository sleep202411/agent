import {
  Prisma,
  type CrewEarningSourceType,
  type CrewEarningStatus,
} from '@prisma/client';
export type EarningReadScope = {
  currency: string;
  crewId?: string;
  userId?: string;
  status?: CrewEarningStatus;
  sourceType?: CrewEarningSourceType;
  createdAt?: { gte?: Date; lt?: Date };
};
type Reader = { $queryRaw<T>(query: Prisma.Sql): Promise<T> };
/** Full-ledger aggregation, independent of cursor/page size. Integer minor units remain exact. */
export async function readEarningTrend(
  db: Reader,
  scope: EarningReadScope,
  now = new Date(),
) {
  if (!scope.userId && !scope.crewId)
    throw new Error('An authorized earning scope is required.');
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - 29);
  const conditions = [
    Prisma.sql`currency = ${scope.currency}`,
    Prisma.sql`status = 'posted'`,
    Prisma.sql`posted_at >= ${start}`,
    Prisma.sql`posted_at <= ${now}`,
  ];
  if (scope.crewId) conditions.push(Prisma.sql`crew_id = ${scope.crewId}`);
  if (scope.userId) conditions.push(Prisma.sql`user_id = ${scope.userId}`);
  if (scope.status) conditions.push(Prisma.sql`status::text = ${scope.status}`);
  if (scope.sourceType)
    conditions.push(Prisma.sql`source_type::text = ${scope.sourceType}`);
  if (scope.createdAt?.gte)
    conditions.push(Prisma.sql`created_at >= ${scope.createdAt.gte}`);
  if (scope.createdAt?.lt)
    conditions.push(Prisma.sql`created_at < ${scope.createdAt.lt}`);
  const rows = await db.$queryRaw<
    Array<{ date: string; amountMinor: string }>
  >(Prisma.sql`
    SELECT to_char(posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
      sum(amount_minor)::text AS "amountMinor"
    FROM crew_earning_entries WHERE ${Prisma.join(conditions, ' AND ')}
    GROUP BY 1 ORDER BY 1
  `);
  const amounts = new Map(rows.map((row) => [row.date, row.amountMinor]));
  return {
    timezone: 'UTC' as const,
    from: start.toISOString(),
    through: now.toISOString(),
    days: Array.from({ length: 30 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + index);
      const day = date.toISOString().slice(0, 10);
      return { date: day, amountMinor: amounts.get(day) ?? '0' };
    }),
  };
}
