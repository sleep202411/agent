import type { Prisma } from '@prisma/client';

export type TaskComputeUsage = {
  taskId: string;
  taskTitle: string;
  userId: string;
  approvedPoints: string;
  pendingPoints: string;
  consumedPoints: string;
  committedPoints: string;
};

export function taskComputeUsage(
  tx: Prisma.TransactionClient,
  crewId: string,
  userId: string,
  owner: boolean,
) {
  return tx.$queryRaw<TaskComputeUsage[]>`
    WITH allowance AS (
      SELECT task_id, user_id,
        COALESCE(SUM(points) FILTER (WHERE status='approved'),0) AS approved,
        COALESCE(SUM(points) FILTER (WHERE status='pending'),0) AS pending
      FROM crew_compute_requests WHERE crew_id=${crewId}
      GROUP BY task_id,user_id
    ), spend AS (
      SELECT t.id AS task_id, w.actor_user_id AS user_id,
        COALESCE(SUM(e.amount) FILTER (WHERE e.entry_type='settle'),0) AS consumed,
        -SUM(e.available_delta) AS committed
      FROM crew_tasks t JOIN crews c ON c.id=t.crew_id
      JOIN wallet_transactions w ON w.project_id=t.canvas_project_id AND w.source_type='ai_job'
      JOIN wallet_ledger_entries e ON e.transaction_id=w.id AND e.currency='compute_point'
      JOIN wallet_accounts a ON a.id=e.account_id AND a.owner_type='workspace' AND a.owner_id=c.workspace_id::text
      WHERE t.crew_id=${crewId} AND w.actor_user_id IS NOT NULL
      GROUP BY t.id,w.actor_user_id
    ), people AS (
      SELECT task_id,user_id FROM allowance UNION SELECT task_id,user_id FROM spend
      UNION SELECT a.task_id,a.user_id FROM crew_task_assignees a JOIN crew_tasks t ON t.id=a.task_id WHERE t.crew_id=${crewId}
    )
    SELECT t.id AS "taskId",t.title AS "taskTitle",p.user_id AS "userId",
      COALESCE(a.approved,0)::text AS "approvedPoints",COALESCE(a.pending,0)::text AS "pendingPoints",
      COALESCE(s.consumed,0)::text AS "consumedPoints",COALESCE(s.committed,0)::text AS "committedPoints"
    FROM people p JOIN crew_tasks t ON t.id=p.task_id
    LEFT JOIN allowance a ON a.task_id=p.task_id AND a.user_id=p.user_id
    LEFT JOIN spend s ON s.task_id=p.task_id AND s.user_id=p.user_id
    WHERE (${owner} OR p.user_id=${userId}) ORDER BY t.number,p.user_id`;
}
