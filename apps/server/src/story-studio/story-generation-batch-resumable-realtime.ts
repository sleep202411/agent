import {
  AiOutboxEventType,
  Prisma,
  StoryGenerationBatchStatus,
  WalletBalanceKind,
  WalletCurrencyType,
  WalletOwnerType,
  type WalletAccount,
} from '@prisma/client';
import type { AssetEvent } from '@repo/shared';
import { enqueueRealtimeEvent } from '../ai-generation/outbox.service';
import { walletWorkspaceChannel } from '../infra/realtime/realtime-groups';

/**
 * Notify-only companion to the wallet_changed push: when a compute-point
 * CREDIT lands on a workspace consumable pot, check whether any previously
 * INSUFFICIENT_COMPUTE_POINTS-blocked Story generation batch now has enough
 * balance for its first unfinished item, and say so on the workspace wallet
 * channel. Clients surface "积分已到账，可继续生成" with a deep link; the
 * creator still decides whether to continue — nothing here auto-resumes a
 * batch or spends points.
 *
 * Runs in the CALLER's transaction (same atomicity contract as
 * enqueueWalletChanged). The resumability check mirrors resume()'s own
 * precondition (first unfinished item's quotedPoints <= available) so the
 * signal never cries wolf.
 */
export async function enqueueStoryBatchesResumableIfFunded(
  tx: Prisma.TransactionClient,
  account: WalletAccount,
  availableDelta: bigint,
): Promise<void> {
  if (availableDelta <= 0n) return;
  if (account.currency !== WalletCurrencyType.compute_point) return;
  if (account.ownerType !== WalletOwnerType.workspace) return;
  if (account.balanceKind !== WalletBalanceKind.consumable) return;

  let after: string | undefined;
  while (true) {
    const blocked = await tx.storyGenerationBatch.findMany({
      where: {
        // Quotes retain their payer across billing-policy changes. Legacy
        // personal-workspace payers may differ from the project's workspace.
        billingSubjectType: 'workspace',
        billingSubjectId: account.ownerId,
        ...(after ? { id: { gt: after } } : {}),
        status: StoryGenerationBatchStatus.blocked,
        OR: [
          {
            blockReason: {
              path: ['code'],
              equals: 'INSUFFICIENT_COMPUTE_POINTS',
            },
          },
          {
            blockReason: {
              path: ['code'],
              equals: 'INSUFFICIENT_UNEXPIRED_COMPUTE_POINTS',
            },
          },
        ],
      },
      select: {
        id: true,
        storyProjectId: true,
        storyChapterId: true,
        items: {
          where: { status: { not: 'completed' } },
          orderBy: { ordinal: 'asc' },
          take: 1,
          select: { quotedPoints: true },
        },
      },
      orderBy: { id: 'asc' },
      take: 20,
    });

    const resumable = blocked
      .filter((batch) => batch.items[0])
      .filter(
        (batch) =>
          BigInt(batch.items[0].quotedPoints) <= account.availableBalance,
      )
      .map((batch) => ({
        batchId: batch.id,
        projectId: batch.storyProjectId,
        chapterId: batch.storyChapterId,
        requiredPoints: batch.items[0].quotedPoints.toString(),
      }));
    if (resumable.length > 0) {
      const event: AssetEvent = {
        kind: 'story_generation_batches_resumable',
        workspaceId: account.ownerId,
        availableBalance: account.availableBalance.toString(),
        batches: resumable,
        ts: Date.now(),
      };
      await enqueueRealtimeEvent(tx, {
        channel: walletWorkspaceChannel(account.ownerId),
        eventType: AiOutboxEventType.story_generation_batches_resumable,
        payload: event as unknown as Prisma.InputJsonValue,
        userId: account.ownerId,
      });
    }
    if (blocked.length < 20) break;
    after = blocked[blocked.length - 1].id;
  }
}
