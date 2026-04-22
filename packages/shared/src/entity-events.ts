/**
 * Entity-change events — cross-layer notification for "some mutable data
 * just changed". Independent from chat messages and workflow lifecycle:
 *
 *   chat-events:     per-project, one conversation's message stream
 *   workflow-events: per-runId, one workflow run's progress
 *   entity-events:   per-userId, ANY mutation (tool call / short-circuit /
 *                    workflow commit / background worker write-back)
 *
 * Why per-userId (not per-project): users routinely have multiple tabs /
 * projects open. An update in one tab should invalidate caches in all
 * tabs. Subscribing by userId gives that for free.
 *
 * Consumers typically just map event → UI-state invalidation (React Query
 * key invalidate, Redux touch action, etc.). The payload intentionally
 * carries the minimum needed to look up the changed record; fetch
 * authoritative data from Java via the normal REST calls.
 */

export const ENTITY_TYPES = [
  "project",
  "world",
  "episode",
  "script",
  "character",
  "scene",
  "prop",
  "storyboard",
  "shot",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_ACTIONS = [
  "created",
  "updated",
  "deleted",
  "batch_created",
  "batch_updated",
  "batch_deleted",
] as const;
export type EntityAction = (typeof ENTITY_ACTIONS)[number];

export interface EntityEvent {
  entity: EntityType;
  action: EntityAction;
  /** Changed record id, when it makes sense for the action. */
  id?: string;
  /** Scoping — publisher should fill what it knows. */
  projectId?: string;
  worldId?: string;
  episodeId?: string;
  /** Server-assigned ms timestamp. */
  ts: number;
  /**
   * Optional free-form source tag for diagnostics / debouncing on the
   * subscriber side (e.g. `"update_project"` / `"role_phase.commit"`).
   */
  source?: string;
}

/** Redis pub/sub channel for a user's entity events. */
export function entityEventsChannel(userId: string): string {
  return `entity:events:${userId}`;
}

export const ENTITY_EVENTS_CHANNEL_PATTERN = "entity:events:*";
export const ENTITY_EVENTS_CHANNEL_PREFIX = "entity:events:";
