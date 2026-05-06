"use client";

/**
 * Synchronous produce-script driver.
 *
 * Trade-off vs the previous async/queue approach: a single POST holds
 * open for ~30-120s while Mastra runs `produce_script_pipeline` inline.
 * If the user closes the tab the fetch aborts; if the agent process
 * crashes the request fails outright. We picked simple over resilient
 * — the user just hits "重试" and re-runs.
 *
 *   start  → POST /aurora/produce/script-draft/sync (blocks until
 *            workflow completes; returns { runId, draft })
 *   commit → POST /aurora/produce/script-draft/commit (writes Java
 *            via the runId)
 *
 * No polling, no resume-on-refresh, no /cancel endpoint. "取消分析" is
 * implemented as `controller.abort()`; the server keeps running until
 * the workflow finishes (we trade some wasted LLM tokens for a much
 * smaller client surface area).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearProduceSeed,
  consumeProduceAutoStart,
  saveProduceCommittedResult,
  type ProduceCommittedResult,
  type ProduceSeed,
} from "./use-produce-seed";

export interface ProduceDraftAsset {
  clientRefId: string;
  name: string;
  description: string;
  prompt: string;
}

export interface ProduceDraftEpisode {
  clientRefId: string;
  no: number;
  title: string;
  introduction: string;
  script: string;
  storyboardRows: Array<{
    shot_no: string;
    scene?: string;
    description: string;
    image_prompt?: string;
    video_prompt?: string;
    movement?: string;
    dialogue?: string;
    shot_size?: string;
    perspective?: string;
    duration?: number;
  }>;
}

export interface ProduceDraft {
  projectId: string;
  worldId?: string;
  title: string;
  sourceName?: string;
  sourceChars?: number;
  language?: string;
  storySummary: string;
  logline?: string;
  genre?: string;
  tone?: string;
  episodes: ProduceDraftEpisode[];
  assets: {
    characters: ProduceDraftAsset[];
    scenes: ProduceDraftAsset[];
    props: ProduceDraftAsset[];
  };
  generatedAt: number;
}

type PipelineStatus =
  | "idle"
  /**
   * Seed exists but the auto-start marker was already consumed (or never
   * set). Distinct from `idle` so the page can render a "previous run
   * was interrupted — retry / abandon" recovery card instead of a blank
   * spinner. Reached when the user refreshes mid-run, or navigates back
   * to the wizard from elsewhere with a stale seed.
   */
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "committing"
  | "committed";

interface PipelineState {
  runId?: string;
  status: PipelineStatus;
  draft?: ProduceDraft;
  committed?: ProduceCommittedResult;
  error?: string;
}

export function useProducePipeline(projectId: string, seed: ProduceSeed | null) {
  const [state, setState] = useState<PipelineState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  // `attempt` is bumped by `start()` / `retry()` to (re)trigger the
  // analysis effect. Initial value 0 = no run requested yet; the mount
  // effect below converts the auto-start marker (when present) into the
  // first attempt.
  const [attempt, setAttempt] = useState(0);

  // Mount-only auto-start gate: consume the one-shot marker the dialog
  // dropped in sessionStorage. If present → bump attempt to fire the
  // run effect once. Refresh / direct nav with a lingering seed sees
  // no marker → settles into `ready` so the page can offer retry
  // / discard. Effect runs once per projectId.
  useEffect(() => {
    if (!projectId || !seed) return;
    if (consumeProduceAutoStart(projectId)) {
      setAttempt((n) => n + 1);
    } else {
      setState((prev) => (prev.status === "idle" ? { status: "ready" } : prev));
    }
  }, [projectId, seed]);

  useEffect(() => {
    if (!projectId || !seed || attempt === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    let stopped = false;

    const run = async () => {
      setState({ status: "running" });
      try {
        const res = await fetch("/aurora/produce/script-draft/sync", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, worldId: seed.worldId, seed }),
          signal: controller.signal,
        });
        if (stopped) return;
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text ? text.slice(0, 200) : `HTTP ${res.status}`);
        }
        const body = (await res.json()) as { runId: string; draft: ProduceDraft };
        if (stopped) return;
        setState({ runId: body.runId, status: "completed", draft: body.draft });
      } catch (err) {
        if (stopped) return;
        if (controller.signal.aborted) {
          setState({ status: "cancelled" });
          return;
        }
        setState({
          status: "failed",
          // English fallback only — the page translates the generic
          // failure title; this string surfaces only when the network
          // / backend gave us nothing concrete to show.
          error: err instanceof Error ? err.message : "Failed to start analysis",
        });
      }
    };

    void run();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [projectId, seed, attempt]);

  const cancel = useCallback(async () => {
    abortRef.current?.abort();
  }, []);

  /**
   * User-initiated start (retry from `ready`, or from the upload entry
   * after writing a fresh seed). Bumps `attempt` to fire the run effect.
   */
  const start = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  /**
   * Drop the seed entirely — sends the page to the "no seed" branch
   * (project-data view). Used by the recovery card's "abandon" action.
   */
  const discard = useCallback(() => {
    clearProduceSeed(projectId);
    setState({ status: "idle" });
  }, [projectId]);

  const commit = useCallback(async (): Promise<ProduceCommittedResult> => {
    const runId = state.runId;
    if (!runId) throw new Error("No analysis run to commit");
    setState((prev) => ({ ...prev, status: "committing", error: undefined }));
    const res = await fetch("/aurora/produce/script-draft/commit", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, projectId, worldId: seed?.worldId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const message = text ? text.slice(0, 200) : `HTTP ${res.status}`;
      setState((prev) => ({ ...prev, status: "completed", error: message }));
      throw new Error(message);
    }
    const body = (await res.json()) as { ok: boolean; result: ProduceCommittedResult };
    saveProduceCommittedResult(projectId, body.result);
    clearProduceSeed(projectId);
    setState((prev) => ({ ...prev, status: "committed", committed: body.result }));
    return body.result;
  }, [projectId, seed?.worldId, state.runId]);

  return { ...state, cancel, retry, start, discard, commit };
}
