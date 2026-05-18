/**
 * Append-only activity log writer.
 *
 * Activity rows are *snapshots* — never updated, never deleted.
 * `actorName` is captured at write time so a later nickname change
 * doesn't rewrite history. Payload shape per type is documented in
 * episodes-spec.md "Activity payload schema".
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { EpisodeActivityType } from '@repo/shared/crew';

type TxClient = Prisma.TransactionClient | PrismaClient;

export interface WriteActivityArgs {
  crewId: string;
  episodeId: string;
  type: EpisodeActivityType;
  actorUserId: string;
  actorName: string;
  payload: Record<string, unknown>;
}

export async function writeActivity(
  db: TxClient,
  args: WriteActivityArgs,
): Promise<void> {
  await db.episodeActivity.create({
    data: {
      crewId: args.crewId,
      episodeId: args.episodeId,
      type: args.type,
      actorUserId: args.actorUserId,
      actorName: args.actorName,
      payload: args.payload as Prisma.InputJsonValue,
    },
  });
}
