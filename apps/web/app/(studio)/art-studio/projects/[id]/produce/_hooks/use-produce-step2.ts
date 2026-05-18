"use client";

/**
 * Step 2 (asset extraction) pipeline driver.
 *
 *   generate() → POST /aurora/produce/step2/generate
 *                blocks ~30-90s while the agent reads episodes from
 *                Java + asks the planner LLM to extract characters /
 *                scenes / props that aren't already in this world.
 *                Returns { runId, draft }.
 *   commit()   → POST /aurora/produce/step2/commit
 *                writes the new rows to Java and returns the
 *                committed asset summary.
 *
 * State machine mirrors `useProducePipeline`'s shape so the page can
 * reason about both with the same vocabulary:
 *
 *   idle → running → completed → committing → committed
 *                              ↘ failed | cancelled  → retry / discard
 *
 * The hook does NOT auto-fire on mount — Step 2 is always user-
 * triggered (the user clicks "生成资产" after reviewing existing rows).
 */
import { useCallback, useRef, useState } from "react";

export interface Step2DraftAsset {
  name: string;
  description: string;
  prompt: string;
}

export interface Step2Draft {
  projectId: string;
  worldId: string;
  characters: Step2DraftAsset[];
  scenes: Step2DraftAsset[];
  props: Step2DraftAsset[];
  existingCounts: { characters: number; scenes: number; props: number };
  generatedAt: number;
}

export interface Step2CommittedAsset {
  clientRefId: string;
  assetType: "role" | "scene" | "prop";
  assetId: string;
  name: string;
  description: string;
  prompt: string;
}

export interface Step2CommittedResult {
  projectId: string;
  worldId: string;
  committedAt: number;
  assets: {
    characters: Step2CommittedAsset[];
    scenes: Step2CommittedAsset[];
    props: Step2CommittedAsset[];
  };
  totals: {
    characterCount: number;
    sceneCount: number;
    propCount: number;
  };
}

type Status =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "committing"
  | "committed";

interface State {
  runId?: string;
  status: Status;
  draft?: Step2Draft;
  committed?: Step2CommittedResult;
  error?: string;
}

export function useProduceStep2(projectId: string, worldId: string | undefined) {
  const [state, setState] = useState<State>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    if (!projectId || !worldId) {
      setState({ status: "failed", error: "missing projectId / worldId" });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "running" });
    try {
      const res = await fetch("/aurora/produce/step2/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, worldId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`[step2/generate] HTTP ${res.status}:`, text);
        throw new Error(text ? text.slice(0, 400) : `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { runId: string; draft: Step2Draft };
      setState({ runId: body.runId, status: "completed", draft: body.draft });
    } catch (err) {
      if (controller.signal.aborted) {
        setState({ status: "cancelled" });
        return;
      }
      setState({
        status: "failed",
        error: err instanceof Error ? err.message : "Failed to extract assets",
      });
    }
  }, [projectId, worldId]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const discard = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: "idle" });
  }, []);

  const commit = useCallback(async (): Promise<Step2CommittedResult> => {
    const runId = state.runId;
    if (!runId) throw new Error("No analysis run to commit");
    setState((prev) => ({ ...prev, status: "committing", error: undefined }));
    const res = await fetch("/aurora/produce/step2/commit", {
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
    const body = (await res.json()) as { ok: boolean; result: Step2CommittedResult };
    setState((prev) => ({ ...prev, status: "committed", committed: body.result }));
    return body.result;
  }, [projectId, worldId, state.runId]);

  return { ...state, generate, cancel, discard, commit };
}
