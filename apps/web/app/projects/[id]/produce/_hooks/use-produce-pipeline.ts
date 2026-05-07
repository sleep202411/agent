"use client";

/**
 * Step 1 (episodes + scripts) sync driver.
 *
 * The hook owns its own seed in React state. State machine:
 *
 *   idle (no seed)              → page shows upload card
 *   running                     → spinner + cancel
 *   completed | committing      → draft review + 保存继续
 *   committed                   → about to navigate to /produce/asset
 *   failed | cancelled          → error + retry (re-uses the same
 *                                 in-memory seed; nothing is lost
 *                                 between retries on the same page)
 *
 * Page mount consumes any sessionStorage seed left by the create-world
 * dialog (one-shot read+delete) and bootstraps the run. After that the
 * sessionStorage slot is gone — refresh / new tab / direct navigation
 * sees no seed and falls through to the upload card. This is the
 * deliberate trade: in exchange for losing in-flight runs on refresh,
 * we drop the auto-start marker / "previous run didn't finish"
 * recovery path entirely.
 *
 *   /produce/step1/generate (POST) → { runId, draft }
 *   /produce/step1/commit   (POST) → writes episodes + scripts to Java,
 *                                    idempotent on the same runId.
 *
 * Browser tab close / route change aborts the in-flight fetch; the
 * agent's route handler picks that up via `c.req.raw.signal` and
 * cancels the in-flight LLM run. The user's wasted compute is
 * bounded by network propagation, not by the workflow's max length.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  consumeProduceSeed,
  saveProduceCommittedResult,
  type ProduceCommittedResult,
  type ProduceSeed,
} from "./use-produce-seed";

export interface Step1DraftEpisode {
  clientRefId: string;
  no: number;
  title: string;
  introduction: string;
  /**
   * Style modifiers applied to every shot in this episode at storyboard
   * time (Step 3). Carried through Step 1 commit so `worldepisode`
   * rows have them populated when Step 3 runs.
   */
  frontPrompt?: string;
  behindPrompt?: string;
  script: string;
}

/**
 * Wire shape returned by /produce/step1/generate. Mirrors the agent's
 * Step1OutputSchema — no assets, no storyboard rows (those land in
 * Step 2 / Step 3 drafts respectively).
 */
export interface Step1Draft {
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
  episodes: Step1DraftEpisode[];
  generatedAt: number;
}

type PipelineStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "committing"
  | "committed";

interface PipelineState {
  runId?: string;
  status: PipelineStatus;
  draft?: Step1Draft;
  committed?: ProduceCommittedResult;
  error?: string;
}

/**
 * Either a seed (dialog hand-off) OR a raw file (reseed flow). The
 * pipeline holds whichever the caller gave it so retry replays the
 * exact same source without forcing the user to re-upload.
 */
type RunSource =
  | { kind: "seed"; seed: ProduceSeed }
  | { kind: "file"; file: File; worldId?: string; worldName: string; description: string };

export function useProducePipeline(projectId: string) {
  const [source, setSource] = useState<RunSource | null>(null);
  const [state, setState] = useState<PipelineState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  // `attempt` re-fires the run effect when bumped — used by the
  // initial mount handoff and by `retry()`.
  const [attempt, setAttempt] = useState(0);

  // Mount: take any seed the dialog dropped in sessionStorage, hold
  // it in React state, and immediately bump attempt to fire the run.
  // sessionStorage is wiped in the same call so refresh / new tab
  // never re-fires from a stale handoff.
  useEffect(() => {
    if (!projectId) return;
    const persisted = consumeProduceSeed(projectId);
    if (persisted) {
      setSource({ kind: "seed", seed: persisted });
      setAttempt((n) => n + 1);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !source || attempt === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    let stopped = false;

    const run = async () => {
      setState({ status: "running" });
      try {
        const res = await postPipelineRun(projectId, source, controller.signal);
        if (stopped) return;
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error(`[step1/generate] HTTP ${res.status}:`, text);
          throw new Error(text ? text.slice(0, 400) : `HTTP ${res.status}`);
        }
        const body = (await res.json()) as { runId: string; draft: Step1Draft };
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
  }, [projectId, source, attempt]);

  const cancel = useCallback(async () => {
    abortRef.current?.abort();
  }, []);

  /**
   * Reseed-card entry point: send the file directly. The pipeline
   * keeps the File in React state so a retry on this mount sends the
   * same bytes again — no re-upload required.
   */
  const runWithFile = useCallback(
    (file: File, opts: { worldId?: string; worldName: string; description?: string }) => {
      setSource({
        kind: "file",
        file,
        worldId: opts.worldId,
        worldName: opts.worldName,
        description: opts.description ?? "",
      });
      setAttempt((n) => n + 1);
    },
    []
  );

  /**
   * Re-run with the same in-memory source (seed from dialog OR file
   * from reseed). No-op if nothing has been captured yet.
   */
  const retry = useCallback(() => {
    if (!source) return;
    setAttempt((n) => n + 1);
  }, [source]);

  /**
   * Forget the current source — sends the page back to the upload
   * card. Used by the failure card's "discard" action and the
   * post-commit cleanup.
   */
  const discard = useCallback(() => {
    setSource(null);
    setState({ status: "idle" });
  }, []);

  const commit = useCallback(async (): Promise<ProduceCommittedResult> => {
    const runId = state.runId;
    if (!runId) throw new Error("No analysis run to commit");
    const worldId = source?.kind === "seed" ? source.seed.worldId : source?.worldId;
    setState((prev) => ({ ...prev, status: "committing", error: undefined }));
    const res = await fetch("/aurora/produce/step1/commit", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, projectId, worldId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const message = text ? text.slice(0, 200) : `HTTP ${res.status}`;
      setState((prev) => ({ ...prev, status: "completed", error: message }));
      throw new Error(message);
    }
    const body = (await res.json()) as { ok: boolean; result: ProduceCommittedResult };
    saveProduceCommittedResult(projectId, body.result);
    setSource(null);
    setState((prev) => ({ ...prev, status: "committed", committed: body.result }));
    return body.result;
  }, [projectId, source, state.runId]);

  return {
    ...state,
    hasSource: source !== null,
    cancel,
    retry,
    runWithFile,
    discard,
    commit,
  };
}

/**
 * Fire the appropriate endpoint for the current run source. Seed
 * sources go to the JSON `step1/generate` (textRef already lives in
 * Redis from spark/analyze). File sources go to the multipart
 * `step1/generate-from-file` so the browser ships the file in one
 * round-trip; the server extracts text before kicking off the
 * workflow.
 */
async function postPipelineRun(
  projectId: string,
  source: RunSource,
  signal: AbortSignal
): Promise<Response> {
  if (source.kind === "seed") {
    return fetch("/aurora/produce/step1/generate", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        worldId: source.seed.worldId,
        seed: source.seed,
      }),
      signal,
    });
  }
  const form = new FormData();
  form.append("file", source.file);
  form.append("projectId", projectId);
  if (source.worldId) form.append("worldId", source.worldId);
  form.append("worldName", source.worldName);
  form.append("description", source.description);
  return fetch("/aurora/produce/step1/generate-from-file", {
    method: "POST",
    credentials: "include",
    body: form,
    signal,
  });
}
