import {
  AiOutboxEventType,
  Prisma,
  WalletCurrencyType,
  type WalletAccount,
} from '@prisma/client';
import type { AssetEvent } from '@repo/shared';
import { enqueueRealtimeEvent } from '../ai-generation/outbox.service';
import { walletWorkspaceChannel } from '../infra/realtime/realtime-groups';

/**
 * Push a wallet account's new balance to its workspace's realtime channel, in
 * the CALLER's transaction (so the event and the balance write commit
 * atomically). Call this right after every `walletAccount.update` that changes a
 * balance — grants (postEntry), AI-gen reserve/settle/release, and expiry — so
 * the studio reflects the change without polling, including cross-actor changes
 * (a teammate spending the shared workspace pot).
 *
 * No-op for non-compute currencies: compute_point is workspace-owned (so the
 * channel is `wallet:workspace:<ownerId>`); the user-owned community_point
 * wallet has no studio channel yet.
 *
 * Lives here (not in ai-generation) so both the workspaces and ai-generation
 * producers can share it without a file-level import cycle.
 */
export async function enqueueWalletChanged(
  tx: Prisma.TransactionClient,
  account: WalletAccount,
  actorUserId?: string | null,
): Promise<void> {
  if (account.currency !== WalletCurrencyType.compute_point) return;
  const event: AssetEvent = {
    kind: 'wallet_changed',
    workspaceId: account.ownerId,
    currency: account.currency,
    balanceKind: account.balanceKind,
    availableBalance: account.availableBalance.toString(),
    heldBalance: account.heldBalance.toString(),
    ts: Date.now(),
  };
  await enqueueRealtimeEvent(tx, {
    channel: walletWorkspaceChannel(account.ownerId),
    eventType: AiOutboxEventType.wallet_changed,
    payload: event as unknown as Prisma.InputJsonValue,
    userId: actorUserId ?? account.ownerId,
  });
}
