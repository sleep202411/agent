/**
 * Slim Aurora generation catalog for Agent OS model settings.
 * Same source as H5 `GET /aurora/ai/models` — only the picker fields.
 */

import { api } from "@/lib/api-client";

const AURORA = { service: "aurora" as const };

const OPERATION_ONLY_MODES = [
  "upscale",
  "remove_background",
  "relight",
  "multi_angle",
  "outpainting",
];

type AiCatalogModality = "image" | "video";

type AiCatalogModel = {
  id?: string;
  name?: string;
  type?: string;
  enabled?: boolean;
  access?: { allowed?: boolean };
  generationModes?: string[];
  input_schema?: { properties?: Record<string, unknown> };
};

export type AiCatalogOption = {
  id: string;
  name: string;
};

export type GenerationCatalog = {
  image: AiCatalogOption[];
  video: AiCatalogOption[];
};

let catalogCache: GenerationCatalog | null = null;
let catalogInflight: Promise<GenerationCatalog> | null = null;

export function getCachedGenerationCatalog(): GenerationCatalog | null {
  return catalogCache;
}

export function loadGenerationCatalog(signal?: AbortSignal): Promise<GenerationCatalog> {
  if (catalogCache) return Promise.resolve(catalogCache);
  if (catalogInflight) return catalogInflight;
  catalogInflight = listGenerationCatalog(signal)
    .then((catalog) => {
      catalogCache = catalog;
      catalogInflight = null;
      return catalog;
    })
    .catch((error) => {
      catalogInflight = null;
      throw error;
    });
  return catalogInflight;
}

async function listGenerationCatalog(signal?: AbortSignal): Promise<GenerationCatalog> {
  const catalog = await api.get<{ models?: AiCatalogModel[] }>("/ai/models", {
    ...AURORA,
    signal,
    timeout: 20_000,
  });
  const models = Array.isArray(catalog.models) ? catalog.models : [];
  return {
    image: toOptions(models, "image"),
    video: toOptions(models, "video"),
  };
}

function toOptions(models: AiCatalogModel[], modality: AiCatalogModality): AiCatalogOption[] {
  return models
    .filter((model) => isUsableGenerationModel(model, modality))
    .map((model) => ({
      id: String(model.id).trim(),
      name:
        typeof model.name === "string" && model.name.trim() ? model.name.trim() : String(model.id),
    }));
}

function isUsableGenerationModel(model: AiCatalogModel, modality: AiCatalogModality): boolean {
  const id = typeof model.id === "string" ? model.id.trim() : "";
  if (!id || model.type !== modality) return false;
  if (model.enabled === false || model.access?.allowed === false) return false;
  if (/hunyuan|panorama/i.test(id)) return false;
  if (model.input_schema?.properties?.dynamicMasks) return false;
  const modes = Array.isArray(model.generationModes) ? model.generationModes : [];
  if (modes.length > 0 && modes.every((mode) => OPERATION_ONLY_MODES.includes(mode))) return false;
  return true;
}
