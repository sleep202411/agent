import { useEffect } from "react";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  setAiModelCache,
  setAiRawModelCache,
  setAiModelCacheLoading,
} from "@/src/store/slices/aiModelCacheSlice";
import { backendApi } from "@/src/lib/api";
import { normalizeAiModel, type RawAiModel } from "@/src/lib/ai-model-schema";
import { ALL_AI_MODEL_PATHS } from "@/src/lib/ai-model-paths";

const idle =
  typeof requestIdleCallback === "function"
    ? requestIdleCallback
    : (cb: () => void) => setTimeout(cb, 1000);

/**
 * Preload all AI models after essential data is loaded.
 * Uses requestIdleCallback to avoid blocking the main thread.
 * Each path is loaded independently — one failure doesn't block others.
 */
export function useAiModelsPreload() {
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const aiModelCache = useAppSelector((s) => s.aiModelCache.aiModelCache);

  useEffect(() => {
    if (!projectId) return;
    // Already loaded
    if (Object.keys(aiModelCache).length > 0) return;

    store.dispatch(setAiModelCacheLoading(true));

    idle(() => {
      const promises = ALL_AI_MODEL_PATHS.map(async (path) => {
        try {
          const raw = await backendApi.post<RawAiModel[]>(
            `/api/ai/record/model/list?path=${encodeURIComponent(path)}`
          );
          const rawModels = (raw ?? []) as RawAiModel[];
          store.dispatch(setAiRawModelCache({ path, models: rawModels }));
          const models = rawModels.map((m) => normalizeAiModel(m));
          store.dispatch(setAiModelCache({ path, models }));
        } catch (err) {
          console.error(`[useAiModelsPreload] Failed to load models for ${path}:`, err);
        }
      });

      Promise.allSettled(promises).then(() => {
        store.dispatch(setAiModelCacheLoading(false));
      });
    });
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
}

const EMPTY_MODELS: never[] = [];
const EMPTY_RAW_MODELS: never[] = [];

/**
 * Get cached AI models for a specific path.
 * Returns normalized AiModel[] from the store cache.
 */
export function useAiModels(path: string) {
  const models = useAppSelector((s) => s.aiModelCache.aiModelCache[path] ?? EMPTY_MODELS);
  const loading = useAppSelector((s) => s.aiModelCache.aiModelCacheLoading);
  return { models, loading };
}

/**
 * Get cached raw AI models (RawAiModel format) for a specific path.
 * Returns raw backend models from the store cache — useful for components
 * that still consume the RawAiModel shape (serviceName, serviceCode, description, etc).
 */
export function useRawAiModels(path: string) {
  const models = useAppSelector((s) => s.aiModelCache.aiRawModelCache[path] ?? EMPTY_RAW_MODELS);
  const loading = useAppSelector((s) => s.aiModelCache.aiModelCacheLoading);
  return { models, loading };
}

/**
 * Non-hook accessor for raw AI models from the store cache.
 * Use this in Zustand stores or callbacks where React hooks are not available.
 */
export function getRawAiModelsFromCache(path: string): RawAiModel[] {
  return store.getState().aiModelCache.aiRawModelCache[path] ?? [];
}
