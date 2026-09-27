import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Sharing requires the uploader's explicit event, not merely confirming bytes. */
export async function requireDisputeAttachments(
  tx: Prisma.TransactionClient,
  disputeId: string,
  userId: string | null,
  ids: readonly string[] | undefined,
) {
  if (!ids?.length) return;
  if (!userId)
    throw new BadRequestException(
      'Only case participants can attach their uploaded evidence.',
    );
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT r.id FROM crew_dispute_attachments r JOIN media_assets a ON a.id=r.media_asset_id
    WHERE r.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    AND r.dispute_id=${disputeId}::uuid AND r.uploader_user_id=${userId}
    AND a.status='ready' AND a.deleted_at IS NULL AND a.moderation_status <> 'blocked'
    FOR SHARE OF r,a`);
  if (rows.length !== ids.length)
    throw new BadRequestException(
      'One or more attachments are unavailable for this case.',
    );
}
