"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearProduceSeed,
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
  | "starting"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "committing"
  | "committed";

interface PipelineState {
  runId?: string;
  status: PipelineStatus;
  progress?: { current: number; total: number; label?: string };
  draft?: ProduceDraft;
  committed?: ProduceCommittedResult;
  error?: string;
}

interface StatusResponse {
  runId: string;
  status: PipelineStatus;
  progress?: { current: number; total: number; label?: string };
  result?: ProduceDraft | null;
  error?: string;
}

export function useProducePipeline(projectId: string, seed: ProduceSeed | null) {
  const [state, setState] = useState<PipelineState>({ status: "idle" });
  const startedRef = useRef(false);
  const runIdRef = useRef<string | undefined>(undefined);
  const statusRef = useRef<PipelineStatus>("idle");

  const patchState = useCallback((patch: Partial<PipelineState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      statusRef.current = next.status;
      if (next.runId) runIdRef.current = next.runId;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!projectId || !seed || startedRef.current) return;
    startedRef.current = true;
    let stopped = false;
    let timer: number | undefined;

    const poll = async (runId: string) => {
      if (stopped) return;
      try {
        const res = await fetch("/aurora/produce/script-draft/status", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, projectId, worldId: seed.worldId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as StatusResponse;
        patchState({
          runId,
          status: body.status,
          progress: body.progress,
          draft: body.result ?? undefined,
          error: body.error,
        });
        if (
          body.status === "completed" ||
          body.status === "failed" ||
          body.status === "cancelled"
        ) {
          if (timer) window.clearInterval(timer);
        }
      } catch (err) {
        patchState({
          status: "failed",
          error: err instanceof Error ? err.message : "状态查询失败",
        });
        if (timer) window.clearInterval(timer);
      }
    };

    const start = async () => {
      patchState({ status: "starting", error: undefined });
      try {
        const res = await fetch("/aurora/produce/script-draft/start", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, worldId: seed.worldId, seed }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { runId: string; status: PipelineStatus };
        runIdRef.current = body.runId;
        patchState({ runId: body.runId, status: body.status });
        await poll(body.runId);
        timer = window.setInterval(() => void poll(body.runId), 1600);
      } catch (err) {
        patchState({
          status: "failed",
          error: err instanceof Error ? err.message : "启动分析失败",
        });
      }
    };

    void start();

    return () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
    };
  }, [patchState, projectId, seed]);

  useEffect(() => {
    const cancelOnLeave = () => {
      const runId = runIdRef.current;
      if (!runId) return;
      if (
        statusRef.current !== "starting" &&
        statusRef.current !== "queued" &&
        statusRef.current !== "running"
      ) {
        return;
      }
      const payload = JSON.stringify({ runId, projectId, worldId: seed?.worldId });
      const blob = new Blob([payload], { type: "application/json" });
      if (!navigator.sendBeacon("/aurora/produce/script-draft/cancel", blob)) {
        void fetch("/aurora/produce/script-draft/cancel", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        });
      }
    };
    window.addEventListener("pagehide", cancelOnLeave);
    return () => window.removeEventListener("pagehide", cancelOnLeave);
  }, [projectId, seed?.worldId]);

  const cancel = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) return;
    await fetch("/aurora/produce/script-draft/cancel", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, projectId, worldId: seed?.worldId }),
    }).catch(() => undefined);
    patchState({ status: "cancelled" });
  }, [patchState, projectId, seed?.worldId]);

  const commit = useCallback(async (): Promise<ProduceCommittedResult> => {
    const runId = runIdRef.current;
    if (!runId) throw new Error("缺少分析任务");
    patchState({ status: "committing", error: undefined });
    const res = await fetch("/aurora/produce/script-draft/commit", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, projectId, worldId: seed?.worldId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const message = text ? text.slice(0, 200) : `HTTP ${res.status}`;
      patchState({ status: "completed", error: message });
      throw new Error(message);
    }
    const body = (await res.json()) as { ok: boolean; result: ProduceCommittedResult };
    saveProduceCommittedResult(projectId, body.result);
    clearProduceSeed(projectId);
    patchState({ status: "committed", committed: body.result });
    return body.result;
  }, [patchState, projectId, seed?.worldId]);

  return { ...state, cancel, commit };
}
