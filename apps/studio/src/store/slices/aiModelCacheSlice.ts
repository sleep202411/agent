import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AiModel, RawAiModel } from "@/src/lib/ai-model-schema";

// ─── State ──────────────────────────────────────────────

interface AiModelCacheState {
  aiModelCache: Record<string, AiModel[]>;
  aiRawModelCache: Record<string, RawAiModel[]>;
  aiModelCacheLoading: boolean;
}

const initialState: AiModelCacheState = {
  aiModelCache: {},
  aiRawModelCache: {},
  aiModelCacheLoading: false,
};

// ─── Slice ──────────────────────────────────────────────

export const aiModelCacheSlice = createSlice({
  name: "aiModelCache",
  initialState,
  reducers: {
    setAiModelCache: (state, action: PayloadAction<{ path: string; models: AiModel[] }>) => {
      state.aiModelCache[action.payload.path] = action.payload.models;
    },
    setAiRawModelCache: (state, action: PayloadAction<{ path: string; models: RawAiModel[] }>) => {
      state.aiRawModelCache[action.payload.path] = action.payload.models;
    },
    setAiModelCacheLoading: (state, action: PayloadAction<boolean>) => {
      state.aiModelCacheLoading = action.payload;
    },
  },
});

export const { setAiModelCache, setAiRawModelCache, setAiModelCacheLoading } =
  aiModelCacheSlice.actions;

// ─── Selectors ──────────────────────────────────────────

export const selectAiModels = (state: { aiModelCache: AiModelCacheState }, path: string) =>
  state.aiModelCache.aiModelCache[path] ?? [];

export const selectRawAiModels = (state: { aiModelCache: AiModelCacheState }, path: string) =>
  state.aiModelCache.aiRawModelCache[path] ?? [];
