import { useCallback, useEffect, useState } from "react";

import {
  storyGenerationBatchHasPendingItems,
  storyProductionApi,
  type StoryAssetSpec,
  type StoryGenerationBatch,
  type StoryStoryboardSequence,
} from "../api/story-production-api";
import { isAgentOsId } from "../lib/ids";

const POLL_MS = 1_500;

/**
 * Polls one generation batch plus its media sources — same cadence as H5
 * `StoryGenerationBatchTranscript` (1.5s while items are still in flight).
 */
export function useStoryGenerationBatch(
  projectId: string,
  chapterId: string,
  batchId: string
): {
  batch: StoryGenerationBatch | null;
  assets: StoryAssetSpec[];
  storyboard: StoryStoryboardSequence[];
  loading: boolean;
  error: string | null;
  actionError: string | null;
  mutating: boolean;
  retry: () => void;
  cancel: () => Promise<void>;
  resume: () => Promise<void>;
} {
  const [batch, setBatch] = useState<StoryGenerationBatch | null>(null);
  const [assets, setAssets] = useState<StoryAssetSpec[]>([]);
  const [storyboard, setStoryboard] = useState<StoryStoryboardSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [tick, setTick] = useState(0);
  const ok = isAgentOsId(projectId) && isAgentOsId(chapterId) && isAgentOsId(batchId);

  const identity = `${projectId}:${chapterId}:${batchId}`;
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (previousIdentity !== identity) {
    setPreviousIdentity(identity);
    setBatch(null);
    setAssets([]);
    setStoryboard([]);
    setLoading(ok);
    setError(null);
    setActionError(null);
  }

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!ok) return;
      return storyProductionApi
        .getGenerationBatch(projectId, chapterId, batchId, signal)
        .then(async (next) => {
          if (signal?.aborted) return;
          setBatch(next);
          setError(null);
          if (
            storyGenerationBatchHasPendingItems(next) ||
            next.status === "queued" ||
            next.status === "running"
          ) {
            setActionError(null);
          }
          const kind = next.items[0]?.targetKind;
          if (kind === "asset_spec") {
            const rows = await storyProductionApi.listAssetSpecs(projectId, chapterId, signal);
            if (signal?.aborted) return;
            setAssets(rows);
            setStoryboard([]);
          } else if (kind === "storyboard_clip") {
            const sequences = await storyProductionApi.getStoryboard(projectId, chapterId, signal);
            if (signal?.aborted) return;
            setStoryboard(sequences);
            setAssets([]);
          }
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [batchId, chapterId, ok, projectId]
  );

  useEffect(() => {
    if (!ok) return;
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load, ok, tick]);

  useEffect(() => {
    if (!ok || !batch || !storyGenerationBatchHasPendingItems(batch)) return;
    const timer = setTimeout(() => setTick((value) => value + 1), POLL_MS);
    return () => clearTimeout(timer);
  }, [batch, ok]);

  const mutate = useCallback(
    async (action: "cancel" | "resume") => {
      if (!ok) return;
      setMutating(true);
      try {
        const next =
          action === "cancel"
            ? await storyProductionApi.cancelGenerationBatch(projectId, chapterId, batchId)
            : await storyProductionApi.resumeGenerationBatch(projectId, chapterId, batchId);
        setBatch(next);
        setActionError(null);
        setTick((value) => value + 1);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
        // Resume may have queued on the server even if the client rejected the
        // envelope — reload so the transcript can catch up.
        setTick((value) => value + 1);
      } finally {
        setMutating(false);
      }
    },
    [batchId, chapterId, ok, projectId]
  );

  return {
    batch,
    assets,
    storyboard,
    loading: ok && loading,
    error,
    actionError,
    mutating,
    retry: () => {
      setLoading(true);
      setError(null);
      setTick((value) => value + 1);
    },
    cancel: () => mutate("cancel"),
    resume: () => mutate("resume"),
  };
}
