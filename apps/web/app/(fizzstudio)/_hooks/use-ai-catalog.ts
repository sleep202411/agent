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

export function imageModels(catalog: FizzAiCatalog | undefined): FizzAiModel[] {
  return (catalog?.models ?? []).filter((model) => model.type === "image");
}

export function usableImageModels(catalog: FizzAiCatalog | undefined): FizzAiModel[] {
  return imageModels(catalog).filter(isFizzAiModelUsable);
}
