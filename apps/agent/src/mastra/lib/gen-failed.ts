/**
 * Per-run side-channel for entities whose LLM generation failed during a
 * phase that still committed partial successes. Read by the matching
 * applyXDrafts at commit time so the completion card can surface
 * "N 项生成失败 — 重试这 N 项" with a scoped retry button.
 *
 * Used by phases that iterate per-entity (storyboard / role / scene /
 * prop / script). Each entry carries a stable identifier the retry path
 * can scope on (e.g. episodeId for storyboard, name for role/scene/prop)
 * plus a sanitized human-readable reason from `mapStructuredOutputError`.
 *
 * TTL matches the workflow run state (30 days) so debug forensics stay
 * available even after the user has long-since walked away.
 */
import { getRedis } from "./redis-client";
import { K, TTL } from "./redis-keys";

export interface GenFailedEntry {
  /** Stable id used for scoped retry (episodeId / role name / scene name / prop name). */
  id: string;
  /** Human-readable label for UI. */
  title: string;
  /** Sanitized reason — already passed through `mapStructuredOutputError`. */
  reason: string;
}

export async function putGenFailed(runId: string, list: GenFailedEntry[]): Promise<void> {
  if (list.length === 0) return;
  await getRedis().set(K.workflowGenFailed(runId), JSON.stringify(list), "EX", TTL.WORKFLOW);
}

export async function readGenFailed(runId: string): Promise<GenFailedEntry[]> {
  try {
    const raw = await getRedis().get(K.workflowGenFailed(runId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as GenFailedEntry[]) : [];
  } catch {
    return [];
  }
}

export async function clearGenFailed(runId: string): Promise<void> {
  try {
    await getRedis().del(K.workflowGenFailed(runId));
  } catch {
    /* swallow — best-effort cleanup */
  }
}
