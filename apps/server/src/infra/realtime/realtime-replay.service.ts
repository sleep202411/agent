/**
 * RealtimeReplayService — serves the catch-up endpoint (`GET
 * /aurora/realtime/negotiate`-sibling `/realtime/replay`). When a client detects
 * a per-channel sequence gap (it received seq N but last saw < N-1, e.g. after a
 * disconnect), it replays the missed events from the durable outbox instead of
 * losing them. The outbox retains dispatched rows for 7 days, so any realistic
 * offline window is recoverable (docs/studio-realtime-architecture.md §3).
 *
 * Authorization reuses the same channel grants as negotiate: a client may only
 * replay a channel it is allowed to subscribe to.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { WorkspaceMemberRole } from '@prisma/client';
import type { AssetEvent } from '@repo/shared';
import { PrismaService } from '../db/db.module';
import { WorkspacePermissionService } from '../../workspaces';
import { StoryPermissionService } from '../../story-studio/story-permission.service';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/** `<prefix>` → the trailing segment is a userId; only that user may replay. */
const USER_SCOPED_PREFIXES = ['assets-user:', 'user:', 'entitlement:user:'];
/** `<prefix>` → the trailing segment is a workspaceId; members (viewer+) may replay. */
const WORKSPACE_SCOPED_PREFIXES = [
  'wallet:workspace:',
  'assets-workspace:',
  'entitlement:workspace:',
  'team:workspace:',
  'project:workspace:',
];

@Injectable()
export class RealtimeReplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: WorkspacePermissionService,
    private readonly storyPermissions: StoryPermissionService,
  ) {}

  async replay(
    userId: string,
    channel: string,
    afterSeq: number,
    limit = DEFAULT_LIMIT,
  ): Promise<{ events: AssetEvent[]; hasMore: boolean }> {
    await this.assertChannelAccess(userId, channel);
    const take = Math.min(
      Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const rows = await this.prisma.aiEventOutbox.findMany({
      where: { channel, seq: { gt: BigInt(Math.trunc(afterSeq)) } },
      orderBy: { seq: 'asc' },
      take,
    });
    const events = rows.map(
      (row) =>
        ({
          ...(row.payload as Record<string, unknown>),
          channel: row.channel ?? undefined,
          seq: row.seq != null ? Number(row.seq) : undefined,
          eventId: row.eventId ?? undefined,
        }) as unknown as AssetEvent,
    );
    return { events, hasMore: rows.length === take };
  }

  private async assertChannelAccess(
    userId: string,
    channel: string,
  ): Promise<void> {
    for (const prefix of USER_SCOPED_PREFIXES) {
      if (channel.startsWith(prefix)) {
        if (channel.slice(prefix.length) !== userId) {
          throw new ForbiddenException('channel_forbidden');
        }
        return;
      }
    }
    for (const prefix of WORKSPACE_SCOPED_PREFIXES) {
      if (channel.startsWith(prefix)) {
        // Throws if the user is not a member — same gate as negotiate.
        await this.permissions.requireWorkspaceRole(
          userId,
          channel.slice(prefix.length),
          WorkspaceMemberRole.viewer,
        );
        return;
      }
    }
    const storyProjectPrefix = 'story:project:';
    if (channel.startsWith(storyProjectPrefix)) {
      const storyProjectId = channel.slice(storyProjectPrefix.length);
      await this.storyPermissions.requireProject(
        userId,
        storyProjectId,
        'story.read',
        { allowArchived: true },
      );
      return;
    }
    throw new ForbiddenException('channel_unsupported');
  }
}
