import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ConversationsService } from '../conversations/conversations.service';
/** Shared transaction boundary for explicit Crew likes and originating-IP likes. */
export async function joinCrewFanTx(
  tx: Prisma.TransactionClient,
  conversations: ConversationsService,
  crewId: string,
  viewerId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crew:block:${viewerId}:${crewId}`})::bigint)`;
  await tx.$queryRaw`SELECT id FROM crews WHERE id = ${crewId} FOR UPDATE`;
  const crew = await tx.crew.findFirst({
    where: {
      id: crewId,
      deletedAt: null,
      listingStatus: 'listed',
      moderationStatus: 'ok',
    },
    select: { id: true },
  });
  if (!crew) throw new NotFoundException('Crew not found');
  const block = await tx.ipUserContentBlock.findFirst({
    where: {
      userId: viewerId,
      targetType: 'crew',
      targetId: crewId,
      unblockedAt: null,
    },
    select: { id: true },
  });
  if (block) throw new NotFoundException('Crew not found');
  return conversations.joinCrewCommunityConversation(crewId, viewerId, tx);
}
