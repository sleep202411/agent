import { Prisma } from '@prisma/client';
import { POINTS_PER_PROJECT_MINUTE } from './project-budget';

type SummaryRow = {
  crewId: string;
  crewName: string;
  producerUserId: string | null;
  durationSeconds: number | null;
  pointsPerMinute: number;
  calculatedPoints: string | null;
  appliedPoints: string;
  approvedPoints: string;
  pendingPoints: string;
  creditedPoints: string;
  differencePoints: string | null;
  warning: boolean;
  closed: boolean;
};

/** One aggregate per project; never sum duplicated request-page usage rows. */
export async function projectPointsSummary(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  query: {
    search?: string;
    state?: 'over' | 'under';
    cursor?: string;
  },
) {
  const rows = await tx.$queryRaw<SummaryRow[]>(Prisma.sql`
    WITH totals AS (
      SELECT crew_id,
        COALESCE(SUM(points) FILTER (WHERE status IN ('pending','approved')),0) AS applied,
        COALESCE(SUM(points) FILTER (WHERE status='approved'),0) AS approved,
        COALESCE(SUM(points) FILTER (WHERE status='pending'),0) AS pending,
        COALESCE(SUM(points) FILTER (WHERE status='approved' AND kind='top_up'),0) AS credited
      FROM crew_compute_requests GROUP BY crew_id
    ), projects AS (
      SELECT c.id AS "crewId", c.name AS "crewName", b.data->>'producerUserId' AS "producerUserId",
        (b.data->>'durationSeconds')::int AS "durationSeconds",
        CASE WHEN b.crew_id IS NULL THEN ${POINTS_PER_PROJECT_MINUTE}
          ELSE COALESCE((b.data->>'pointsPerMinute')::int,4462) END AS "pointsPerMinute",
        b.data->>'totalPoints' AS "calculatedPoints",
        COALESCE(t.applied,0)::text AS "appliedPoints", COALESCE(t.approved,0)::text AS "approvedPoints",
        COALESCE(t.pending,0)::text AS "pendingPoints", COALESCE(t.credited,0)::text AS "creditedPoints",
        (COALESCE(t.applied,0)-(b.data->>'totalPoints')::numeric)::text AS "differencePoints",
        COALESCE(ABS(COALESCE(t.applied,0)-(b.data->>'totalPoints')::numeric)*100 > (b.data->>'totalPoints')::numeric*20,false) AS warning,
        COALESCE(b.data->'settlement' <> 'null'::jsonb,false) AS closed
      FROM crews c LEFT JOIN crew_project_compute_budgets b ON b.crew_id=c.id
        LEFT JOIN totals t ON t.crew_id=c.id
      WHERE c.deleted_at IS NULL AND (c.workspace_id IS NOT NULL OR t.crew_id IS NOT NULL)
        AND (${query.search ?? ''} = '' OR POSITION(LOWER(${query.search ?? ''}) IN LOWER(c.name)) > 0)
    )
    SELECT * FROM projects WHERE
      (${query.cursor ?? ''} = '' OR "crewId" > ${query.cursor ?? ''}) AND
      (${query.state ?? ''} = '' OR
        (${query.state ?? ''}='over' AND "differencePoints"::numeric > 0) OR
        (${query.state ?? ''}='under' AND "differencePoints"::numeric <= 0))
    ORDER BY "crewId" LIMIT 26
  `);
  return {
    items: rows.slice(0, 25),
    nextCursor: rows.length > 25 ? rows[24].crewId : null,
  };
}
