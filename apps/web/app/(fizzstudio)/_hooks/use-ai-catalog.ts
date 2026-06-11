"use client";

import { useQuery } from "@tanstack/react-query";
import {
  isFizzAiModelUsable,
  listFizzAiCatalog,
  type FizzAiCatalog,
  type FizzAiModel,
} from "../_lib/generation-api";

export const aiCatalogKeys = {
  all: ["fizzstudio", "ai-catalog"] as const,
  catalog: () => [...aiCatalogKeys.all, "models"] as const,
};

/**
 * Loads the real AI generation catalog (GET /aurora/ai/models). The catalog
 * rarely changes per-session, so we cache it generously. Entitlement (`access`)
 * is stamped per-user server-side, so this is keyed without a user dimension on
 * purpose — React Query already scopes by the auth'd transport client.
 */
export function useAiCatalog() {
  return useQuery({
    queryKey: aiCatalogKeys.catalog(),
    queryFn: listFizzAiCatalog,
    staleTime: 5 * 60_000,
  });
}

/**
 * UI modality for the studio surface. `image`/`video` are real catalog +
 * job-system modalities; `audio` is a layout-only modality for now (voice/audio
 * generation runs on the separate Java voice service, not this catalog), so it
 * resolves to an empty model list until audio models are wired in.
 */
export type StudioModality = FizzAiModel["type"] | "audio";

export function modelsByModality(
  catalog: FizzAiCatalog | undefined,
  modality: StudioModality
): FizzAiModel[] {
  return (catalog?.models ?? []).filter((model) => model.type === modality);
}

export function usableModelsByModality(
  catalog: FizzAiCatalog | undefined,
  modality: StudioModality
): FizzAiModel[] {
  return modelsByModality(catalog, modality).filter(isFizzAiModelUsable);
}

export function imageModels(catalog: FizzAiCatalog | undefined): FizzAiModel[] {
  return modelsByModality(catalog, "image");
}

export function usableImageModels(catalog: FizzAiCatalog | undefined): FizzAiModel[] {
  return usableModelsByModality(catalog, "image");
}
