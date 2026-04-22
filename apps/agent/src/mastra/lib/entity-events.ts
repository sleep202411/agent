/**
 * Entity-event publisher — agent-side writes publish to a user-scoped
 * Redis channel that Nest's WS gateway fans out to all that user's open
 * tabs. Consumers invalidate caches / refetch without relying on the
 * LLM reply to carry a `action` signal.
 *
 * Callers: atomic CRUD tools (update_*, delete_*, add_*), workflow
 * commit steps, image-worker write-back.
 *
 * Best-effort: failure is logged, never thrown — a missed notification
 * just means the user's UI refreshes on the next poll / navigation,
 * not a functional regression.
 */
import {
  entityEventsChannel,
  type EntityAction,
  type EntityEvent,
  type EntityType,
} from "@repo/shared/entity-events";
import { getRedis } from "./redis-client";
import type { StoryosContext } from "./workspace-client";

export interface PublishEntityEventInput {
  entity: EntityType;
  action: EntityAction;
  id?: string;
  projectId?: string;
  worldId?: string;
  episodeId?: string;
  source?: string;
}

/**
 * Publish an entity event for the current user. projectId / worldId /
 * episodeId default to the values on `ctx` so most callers just need
 * to pass entity + action.
 */
export async function publishEntityEvent(
  ctx: StoryosContext,
  input: PublishEntityEventInput
): Promise<void> {
  const event: EntityEvent = {
    entity: input.entity,
    action: input.action,
    id: input.id,
    projectId: input.projectId ?? ctx.projectId,
    worldId: input.worldId ?? ctx.worldId,
    episodeId: input.episodeId ?? ctx.episodeId,
    source: input.source,
    ts: Date.now(),
  };
  try {
    const redis = getRedis();
    const channel = entityEventsChannel(ctx.userId);
    const subscribers = await redis.publish(channel, JSON.stringify(event));
    // eslint-disable-next-line no-console
    console.log(
      `[entity-events] published channel=${channel} entity=${input.entity}/${input.action} subscribers=${subscribers}`
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[entity-events] publish failed userId=${ctx.userId} entity=${input.entity}/${input.action}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
