"use client";

import { useQuery } from "@tanstack/react-query";
import {
  isFizzAiModelUsable,
  isFizzAiModelVisible,
  listFizzAiCatalog,
  type FizzAiCatalog,
  type FizzAiModel,
} from "./generation-api";

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
 * UI modality for the studio surface. The catalog may expose image, video or
 * audio models; products render the same schema-driven selection contract for
 * every modality instead of carrying a separate voice-service exception.
 */
export type StudioModality = FizzAiModel["type"];

export function modelsByModality(
  catalog: FizzAiCatalog | undefined,
  modality: StudioModality
): FizzAiModel[] {
  return (catalog?.models ?? []).filter((model) => model.type === modality);
}

/**
 * Models this user can actually run. For code that CHOOSES a model —
 * defaults, auto-select, presets, copilot tools — never for a picker list.
 */
export function usableModelsByModality(
  catalog: FizzAiCatalog | undefined,
  modality: StudioModality
): FizzAiModel[] {
  return modelsByModality(catalog, modality).filter(isFizzAiModelUsable);
}

/**
 * Models to SHOW, including ones this user's plan can't run — those render as
 * locked rows. Pickers use this; anything that auto-selects must not.
 */
export function visibleModelsByModality(
  catalog: FizzAiCatalog | undefined,
  modality: StudioModality
): FizzAiModel[] {
  return modelsByModality(catalog, modality).filter(isFizzAiModelVisible);
}

export function imageModels(catalog: FizzAiCatalog | undefined): FizzAiModel[] {
  return modelsByModality(catalog, "image");
}

export function usableImageModels(catalog: FizzAiCatalog | undefined): FizzAiModel[] {
  return usableModelsByModality(catalog, "image");
}
