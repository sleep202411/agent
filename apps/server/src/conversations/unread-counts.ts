import { Prisma } from '@prisma/client';

/** Internal projection for callers that have already scoped conversation access. */
export async function conversationUnreadCounts(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  conversationIds: string[],
  userIds: string[],
): Promise<Array<{ conversationId: string; userId: string; unread: number }>> {
  if (conversationIds.length === 0 || userIds.length === 0) return [];
  return db.$queryRaw(Prisma.sql`
    SELECT p.conversation_id AS "conversationId", p.user_id AS "userId", COUNT(m.id)::int AS "unread"
    FROM conversation_participants p
    LEFT JOIN messages m
      ON m.conversation_id = p.conversation_id
     AND m.deleted_at IS NULL
     AND (m.author_id IS NULL OR m.author_id <> p.user_id)
     AND (
           p.last_read_at IS NULL
           OR (m.created_at, m.id)
              > (p.last_read_at, COALESCE(p.last_read_message_id, ''))
         )
    WHERE p.conversation_id IN (${Prisma.join(conversationIds)})
      AND p.user_id IN (${Prisma.join(userIds)})
    GROUP BY p.conversation_id, p.user_id
  `);
}
