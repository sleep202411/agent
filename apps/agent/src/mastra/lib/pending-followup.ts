/**
 * Pending workflow followup — closes the auto-redirect loop.
 *
 * When `invoke_workflow` is asked to run a phase that needs an outline
 * but the artifact doesn't exist yet, the dispatcher transparently
 * substitutes `story_outline` and writes a followup record here keyed
 * by the substituted run's id. After story_outline lands, the worker
 * reads + clears the record and auto-dispatches the original
 * workflow with its original inputData. The user clicks once and the
 * pipeline runs to completion.
 *
 * Stored per-runId (not per-project) so concurrent project actions
 * can each carry their own followup without overwriting siblings.
 * Short TTL (1 hour) is enough — outline runs land in minutes; if
 * something stalls past that the followup just doesn't fire and the
 * UI's MISSING_ARTIFACT remediation button takes over.
 */
import { getRedis } from "./redis-client";
import type { WorkflowName } from "./redis-keys";
import type { StoryosContext } from "./workspace-client";

const TTL_SECONDS = 60 * 60;

function key(runId: string): string {
  return `workflow:run:${runId}:pending_followup`;
}

export interface PendingFollowup {
  /** Workflow the user originally asked the supervisor to run. */
  workflowName: WorkflowName;
  /** Resolved inputData (post-injection) ready to feed into startWorkflow. */
  inputData: Record<string, unknown>;
  /** Snapshot of the dispatching context. Worker rebuilds the
   *  RequestContext from this when it auto-fires the followup. */
  ctx: StoryosContext;
  /** Original requested workflow + reason, for diagnostic logging. */
  reason: string;
}

export async function setPendingFollowup(
  triggerRunId: string,
  payload: PendingFollowup
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(key(triggerRunId), JSON.stringify(payload), "EX", TTL_SECONDS);
  } catch (err) {
    // Non-fatal — losing the followup just means the user has to
    // re-trigger their original workflow manually (UI's
    // MISSING_ARTIFACT button or supervisor follow-up still work).
    console.warn(
      `[pending-followup] set failed for runId=${triggerRunId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Read + delete (atomic via GETDEL on Redis 6.2+; falls back to
 * GET+DEL on older clients). Atomic so two parallel completion
 * handlers can't both fire the followup.
 */
export async function takePendingFollowup(triggerRunId: string): Promise<PendingFollowup | null> {
  try {
    const redis = getRedis();
    let raw: string | null = null;
    if (
      typeof (redis as unknown as { getdel?: (k: string) => Promise<string | null> }).getdel ===
      "function"
    ) {
      raw = await (redis as unknown as { getdel: (k: string) => Promise<string | null> }).getdel(
        key(triggerRunId)
      );
    } else {
      raw = await redis.get(key(triggerRunId));
      if (raw) await redis.del(key(triggerRunId));
    }
    if (!raw) return null;
    return JSON.parse(raw) as PendingFollowup;
  } catch (err) {
    console.warn(
      `[pending-followup] take failed for runId=${triggerRunId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
