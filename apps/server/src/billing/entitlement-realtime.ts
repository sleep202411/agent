import { AiOutboxEventType, BillingSubjectType, Prisma } from '@prisma/client';
import type { AssetEvent } from '@repo/shared';
import { enqueueRealtimeEvent } from '../ai-generation/outbox.service';
import {
  entitlementUserChannel,
  entitlementWorkspaceChannel,
} from '../infra/realtime/realtime-groups';

/**
 * Push an entitlement (plan) change to its subject's channel, in the CALLER's
 * transaction (atomic with the grant write). Entitlements are dual-scope: a
 * personal plan (entitlement:user:<userId>) or a workspace plan
 * (entitlement:workspace:<wsId>) — routed by the grant's subjectType. The event
 * status is derived from the action so the caller can pass the pre- or
 * post-write grant (the unchanging subject/plan/period fields are what matter).
 * Mirrors wallet-realtime.ts (no file-level import cycle).
 */
export async function enqueueEntitlementChanged(
  tx: Prisma.TransactionClient,
  grant: {
    subjectType: BillingSubjectType;
    subjectId: string;
    planKey: string;
    startsAt: Date;
    endsAt: Date | null;
  },
  action: 'fulfilled' | 'revoked' | 'restored' | 'expired',
  actorUserId?: string | null,
): Promise<void> {
  const isUser = grant.subjectType === BillingSubjectType.user;
  const status =
    action === 'revoked'
      ? 'revoked'
      : action === 'expired'
        ? 'expired'
        : 'active';
  const event: AssetEvent = {
    kind: 'entitlement_changed',
    subjectType: isUser ? 'user' : 'workspace',
    subjectId: grant.subjectId,
    planKey: grant.planKey,
    status,
    startsAt: grant.startsAt.toISOString(),
    endsAt: grant.endsAt ? grant.endsAt.toISOString() : null,
    action,
    ts: Date.now(),
  };
  await enqueueRealtimeEvent(tx, {
    channel: isUser
      ? entitlementUserChannel(grant.subjectId)
      : entitlementWorkspaceChannel(grant.subjectId),
    eventType: AiOutboxEventType.entitlement_changed,
    payload: event as unknown as Prisma.InputJsonValue,
    userId: actorUserId ?? grant.subjectId,
  });
}
