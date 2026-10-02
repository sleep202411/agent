"use client";

import { useCallback, type SetStateAction } from "react";
import { create } from "zustand";
import { useAuth } from "@/app/_components/auth-provider";
import { useProjectPayerWorkspace } from "@/app/[locale]/project/_components/project-context";
import type { ModelSettings } from "@/lib/canvas-authoring/generation-api";
import type { ReferenceUpload } from "./use-reference-uploads";

type Draft = {
  prompt: string;
  modelId?: string;
  settings?: ModelSettings;
  mode?: string;
  references: ReferenceUpload[];
};
const EMPTY: Draft = { prompt: "", references: [] };

// Client drafts only. Catalog models, jobs and balances remain server-owned.
export const useComposerDraftStore = create<{
  drafts: Record<string, Draft>;
  update: <K extends keyof Draft>(key: string, field: K, value: SetStateAction<Draft[K]>) => void;
}>((set) => ({
  drafts: {},
  update: (key, field, value) =>
    set((state) => {
      const draft = state.drafts[key] ?? EMPTY;
      const next = typeof value === "function" ? value(draft[field]) : value;
      return { drafts: { ...state.drafts, [key]: { ...draft, [field]: next } } };
    }),
}));

export function useComposerDraft(modality: "image" | "video" | "audio" | "project") {
  const { user } = useAuth();
  const workspace = useProjectPayerWorkspace();
  const key = JSON.stringify([user?.id ?? null, workspace?.id ?? null, modality]);
  const draft = useComposerDraftStore((state) => state.drafts[key] ?? EMPTY);
  const update = useComposerDraftStore((state) => state.update);
  const setPrompt = useCallback((value: string) => update(key, "prompt", value), [key, update]);
  const setModelId = useCallback((value: string) => update(key, "modelId", value), [key, update]);
  const setSettings = useCallback(
    (value: ModelSettings) => update(key, "settings", value),
    [key, update]
  );
  const setMode = useCallback(
    (value: string | undefined) => update(key, "mode", value),
    [key, update]
  );
  const setReferences = useCallback(
    (value: SetStateAction<ReferenceUpload[]>) => update(key, "references", value),
    [key, update]
  );
  return { ...draft, setPrompt, setModelId, setSettings, setMode, setReferences };
}
