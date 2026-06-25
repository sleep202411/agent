import { AiOutboxEventType, Prisma } from '@prisma/client';
import type { AssetEvent } from '@repo/shared';
import { enqueueRealtimeEvent } from '../ai-generation/outbox.service';
import { projectWorkspaceChannel } from '../infra/realtime/realtime-groups';

/**
 * Push a project-list change (created / updated / archived) to the owning
 * workspace's channel, in the CALLER's transaction (atomic with the project
 * write). Workspace members are granted `project:workspace:<wsId>` on connect, so
 * everyone's project list reflects the change live. State-derived: clients
 * refetch the list on the signal. Mirrors wallet-realtime.ts (no import cycle).
 */
export async function enqueueProjectChanged(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    projectId: string;
    action: 'created' | 'updated' | 'archived';
    actorUserId?: string | null;
  },
): Promise<void> {
  const event: AssetEvent = {
    kind: 'project_changed',
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    action: input.action,
    ts: Date.now(),
  };
  await enqueueRealtimeEvent(tx, {
    channel: projectWorkspaceChannel(input.workspaceId),
    eventType: AiOutboxEventType.project_changed,
    payload: event as unknown as Prisma.InputJsonValue,
    userId: input.actorUserId ?? input.workspaceId,
  });
}
