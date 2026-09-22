import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ConversationsService } from '../conversations/conversations.service';
/** Shared transaction boundary for explicit Crew likes and originating-IP likes. */
type FanConversation = Awaited<
  ReturnType<ConversationsService['joinCrewCommunityConversation']>
>;
export function joinCrewFanTx(
  tx: Prisma.TransactionClient,
  conversations: ConversationsService,
  crewId: string,
  viewerId: string,
): Promise<FanConversation>;
export function joinCrewFanTx(
  tx: Prisma.TransactionClient,
  conversations: ConversationsService,
  crewId: string,
  viewerId: string,
  skipUnlisted: true,
): Promise<FanConversation | null>;
export async function joinCrewFanTx(
  tx: Prisma.TransactionClient,
  conversations: ConversationsService,
  crewId: string,
  viewerId: string,
  skipUnlisted = false,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crew:block:${viewerId}:${crewId}`})::bigint)`;
  await tx.$queryRaw`SELECT id FROM crews WHERE id = ${crewId} FOR UPDATE`;
  const crew = await tx.crew.findFirst({
    where: {
      id: crewId,
      deletedAt: null,
      moderationStatus: 'ok',
    },
    select: { id: true, listingStatus: true },
  });
  if (!crew) throw new NotFoundException('Crew not found');
  if (crew.listingStatus !== 'listed') {
    if (skipUnlisted) return null;
    throw new NotFoundException('Crew not found');
  }
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
