import { AiOutboxEventType, Prisma } from '@prisma/client';
import type { AssetEvent } from '@repo/shared';
import { enqueueRealtimeEvent } from '../ai-generation/outbox.service';
import { teamWorkspaceChannel } from '../infra/realtime/realtime-groups';

/**
 * Push a workspace membership change to the workspace's team channel, in the
 * CALLER's transaction (atomic with the membership write). Every current member
 * of the workspace is granted `team:workspace:<wsId>` on connect, so they all see
 * the roster update live — including changes another admin made. State-derived:
 * clients refetch the roster on the signal rather than applying the delta.
 *
 * Placed in sharing/ (not ai-generation) so it shares enqueueRealtimeEvent
 * without a file-level import cycle, mirroring wallet-realtime.ts.
 */
export async function enqueueTeamMemberChanged(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    action: 'added' | 'removed' | 'role_changed';
    member: { id: string; userId: string; role: string; status?: string };
    actorUserId?: string | null;
  },
): Promise<void> {
  const event: AssetEvent = {
    kind: 'team_member_changed',
    workspaceId: input.workspaceId,
    action: input.action,
    member: input.member,
    ts: Date.now(),
  };
  await enqueueRealtimeEvent(tx, {
    channel: teamWorkspaceChannel(input.workspaceId),
    eventType: AiOutboxEventType.team_member_changed,
    payload: event as unknown as Prisma.InputJsonValue,
    userId: input.actorUserId ?? input.member.userId,
  });
}
