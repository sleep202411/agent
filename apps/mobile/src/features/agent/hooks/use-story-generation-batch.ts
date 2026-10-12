import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  storyGenerationBatchHasPendingItems,
  storyProductionApi,
  type StoryAssetSpec,
  type StoryGenerationBatch,
  type StoryStoryboardSequence,
} from "../api/story-production-api";
import { isAgentOsId } from "../lib/ids";
import { useStoryRequestScope } from "./use-story-request-scope";

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
  cancelError: string | null;
  resumeError: string | null;
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
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [tick, setTick] = useState(0);
  const identity = useStoryRequestScope(`${projectId}:${chapterId}:${batchId}`);
  const ok =
    identity.enabled && isAgentOsId(projectId) && isAgentOsId(chapterId) && isAgentOsId(batchId);
  const currentScope = useRef<typeof identity | null>(identity);
  const activeRead = useRef<AbortController | null>(null);
  const activeAction = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    currentScope.current = identity;
    return () => {
      currentScope.current = null;
      activeRead.current?.abort();
      activeAction.current?.abort();
      activeRead.current = null;
      activeAction.current = null;
    };
  }, [identity]);
  const [previousIdentity, setPreviousIdentity] = useState(identity);
  if (previousIdentity !== identity) {
    setPreviousIdentity(identity);
    setBatch(null);
    setAssets([]);
    setStoryboard([]);
    setLoading(ok);
    setError(null);
    setCancelError(null);
    setResumeError(null);
    setMutating(false);
  }

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!ok || currentScope.current !== identity || activeAction.current) return;
      return storyProductionApi
        .getGenerationBatch(projectId, chapterId, batchId, signal)
        .then(async (next) => {
          if (signal?.aborted) return;
          setBatch(next);
          setError(null);
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
          } else {
            setAssets([]);
            setStoryboard([]);
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
    [batchId, chapterId, ok, projectId, identity]
  );

  useEffect(() => {
    if (!ok || mutating) return;
    const ac = new AbortController();
    activeRead.current = ac;
    void load(ac.signal);
    return () => {
      ac.abort();
      if (activeRead.current === ac) activeRead.current = null;
    };
  }, [load, ok, tick, mutating]);

  useEffect(() => {
    if (!ok || mutating || !batch || !storyGenerationBatchHasPendingItems(batch)) return;
    const timer = setTimeout(() => setTick((value) => value + 1), POLL_MS);
    return () => clearTimeout(timer);
  }, [batch, ok, mutating]);

  const mutate = useCallback(
    async (action: "cancel" | "resume") => {
      if (!ok || currentScope.current !== identity || activeAction.current) return;
      const controller = new AbortController();
      activeAction.current = controller;
      activeRead.current?.abort();
      setMutating(true);
      const current = () =>
        currentScope.current === identity &&
        !controller.signal.aborted &&
        activeAction.current === controller;
      const report = action === "cancel" ? setCancelError : setResumeError;
      report(null);
      try {
        const next =
          action === "cancel"
            ? await storyProductionApi.cancelGenerationBatch(
                projectId,
                chapterId,
                batchId,
                controller.signal
              )
            : await storyProductionApi.resumeGenerationBatch(
                projectId,
                chapterId,
                batchId,
                controller.signal
              );
        if (!current()) return;
        setBatch(next);
        report(null);
      } catch (err) {
        if (!current()) return;
        report(err instanceof Error ? err.message : String(err));
      } finally {
        if (current()) {
          activeAction.current = null;
          setMutating(false);
          // A response failure may still have accepted work server-side.
          setTick((value) => value + 1);
        }
      }
    },
    [batchId, chapterId, ok, projectId, identity]
  );

  return {
    batch,
    assets,
    storyboard,
    loading: ok && loading,
    error,
    cancelError,
    resumeError,
    mutating,
    retry: () => {
      if (!ok || currentScope.current !== identity || activeAction.current) return;
      setLoading(true);
      setError(null);
      setTick((value) => value + 1);
    },
    cancel: () => mutate("cancel"),
    resume: () => mutate("resume"),
  };
}
