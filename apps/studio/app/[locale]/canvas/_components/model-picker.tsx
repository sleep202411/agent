"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconBolt,
  IconBrandGoogle,
  IconBrandOpenai,
  IconBrandTiktok,
  IconCheck,
  IconCube,
  IconSearch,
  IconSparkles,
  type Icon,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  cheapestSellPoints,
  isOperationOnlyModel,
  type FizzAiCatalog,
  type FizzAiModel,
} from "@/app/[locale]/canvas/_lib/generation-api";
import { usableModelsByModality } from "@/app/[locale]/canvas/_lib/use-ai-catalog";

/** Pick a provider brand glyph from the model id/name. */
function brandIcon(model: FizzAiModel): Icon {
  const s = `${model.id} ${model.name}`.toLowerCase();
  if (s.includes("gpt") || s.includes("openai") || s.includes("dall")) return IconBrandOpenai;
  if (
    s.includes("nano-banana") ||
    s.includes("gemini") ||
    s.includes("imagen") ||
    s.includes("google")
  )
    return IconBrandGoogle;
  if (s.includes("seedance") || s.includes("seedream") || s.includes("byte"))
    return IconBrandTiktok;
  if (s.includes("flux")) return IconBolt;
  if (s.includes("wan") || s.includes("qwen") || s.includes("alibaba") || s.includes("bailian"))
    return IconCube;
  return IconSparkles;
}

function isFeaturedModel(model: FizzAiModel, selectedId: string | undefined): boolean {
  return model.id === selectedId || model.ui_policy?.recommended === true;
}

type ModelTaglineKey =
  | "fastLowCostImage"
  | "fastBalancedImage"
  | "fastDraftImage"
  | "flagshipImage"
  | "highQualityImage"
  | "photorealImage"
  | "textClearImage"
  | "balancedImage"
  | "creativeImage"
  | "fastLowCostVideo"
  | "fastBalancedVideo"
  | "cinematicVideo"
  | "stableMotionVideo"
  | "creativeVideo";

const MODEL_TAGLINES: Record<string, ModelTaglineKey> = {
  "gpt-image-2": "textClearImage",
  "flux-2-pro": "photorealImage",
  "flux-2-flex": "textClearImage",
  "flux-2-max": "flagshipImage",
  "flux-2-dev": "fastLowCostImage",
  "wan-image-2.7-pro": "highQualityImage",
  "wan-image-2.7": "balancedImage",
  "qwen-image-2.0-pro": "textClearImage",
  "qwen-image-2.0": "balancedImage",
  "nano-banana": "fastLowCostImage",
  "quick-image-1-0": "fastLowCostImage",
  "nano-banana-2": "fastBalancedImage",
  "nano-banana-pro": "flagshipImage",
  "seedream-4": "creativeImage",
  "seedream-4.5": "highQualityImage",
  "seedream-5-lite": "fastBalancedImage",
  "quick-video-1-0": "fastLowCostVideo",
  "seedance-2-0": "cinematicVideo",
  "seedance-2-0-fast": "fastBalancedVideo",
  "wan-2-7": "stableMotionVideo",
  "happyhorse-1-0": "creativeVideo",
  "kling-motion": "stableMotionVideo",
};

function modelTaglineKey(model: FizzAiModel): ModelTaglineKey {
  return (
    MODEL_TAGLINES[model.id] ?? (model.type === "video" ? "stableMotionVideo" : "fastDraftImage")
  );
}

function modelSearchRank(model: FizzAiModel, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = model.name.toLowerCase();
  const words = name.split(/[^a-z0-9]+/).filter(Boolean);

  if (name.startsWith(q)) return 0;
  if (words.some((word) => word.startsWith(q))) return 1;
  if (name.includes(q)) return 2;
  return Number.POSITIVE_INFINITY;
}

type ModelSection = {
  id: string;
  title: string;
  icon: Icon;
  models: FizzAiModel[];
};

/** Floating model selector opened from the composer's model pill. */
export function ModelPicker({
  catalog,
  modality,
  selectedId,
  placement = "top",
  align = "left",
  onSelect,
  onClose,
}: {
  catalog: FizzAiCatalog | undefined;
  modality: "image" | "video";
  selectedId?: string;
  placement?: "top" | "bottom";
  align?: "left" | "right";
  onSelect: (model: FizzAiModel) => void;
  onClose: () => void;
}) {
  const t = useTranslations("canvasControls");
  const [query, setQuery] = useState("");

  const sections = useMemo<ModelSection[]>(() => {
    // Operation-only models (Upscale / Remove BG / 720°) are reached via their
    // image-toolbar actions, not the general picker.
    const all = (catalog ? usableModelsByModality(catalog, modality) : []).filter(
      (m) => !isOperationOnlyModel(m) && !/hunyuan|panorama/i.test(m.id)
    );
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all
          .map((model, index) => ({
            model,
            index,
            rank: modelSearchRank(model, q),
          }))
          .filter((item) => Number.isFinite(item.rank))
          .sort((a, b) => a.rank - b.rank || a.index - b.index)
          .map((item) => item.model)
      : all;
    if (q) {
      return [
        {
          id: "search",
          title: t("modelPicker.searchResults"),
          icon: IconSearch,
          models: filtered,
        },
      ];
    }

    const featured = filtered.filter((model) => isFeaturedModel(model, selectedId));
    const featuredIds = new Set(featured.map((model) => model.id));
    const remaining = filtered.filter((model) => !featuredIds.has(model.id));
    return [
      ...(featured.length > 0
        ? [
            {
              id: "featured",
              title: t("modelPicker.featuredModels"),
              icon: IconSparkles,
              models: featured,
            },
          ]
        : []),
      ...(remaining.length > 0
        ? [
            {
              id: "all",
              title: t("modelPicker.allModels"),
              icon: IconSparkles,
              models: remaining,
            },
          ]
        : []),
    ];
  }, [catalog, modality, query, selectedId, t]);

  const hasModels = sections.some((section) => section.models.length > 0);

  return (
    <div
      role="dialog"
      aria-label={t("modelPicker.allModels")}
      className={cn(
        "nodrag absolute z-50 flex max-h-[460px] w-[380px] flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[oklch(0.235_0_0_/_0.95)] shadow-2xl shadow-black/60 backdrop-blur-2xl",
        "duration-150 animate-in fade-in-0 zoom-in-95",
        placement === "top" ? "bottom-full mb-2 origin-bottom" : "top-full mt-2 origin-top",
        align === "left" ? "left-0" : "right-0"
      )}
    >
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3">
        <IconSearch className="size-4.5 shrink-0 text-muted-foreground" stroke={1.8} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("modelPicker.searchPlaceholder")}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="mx-1 h-px bg-border" />

      <div
        data-canvas-scroll-owner="y"
        className="nowheel min-h-0 flex-1 space-y-3 overflow-y-auto p-2"
      >
        {!hasModels && (
          <p className="p-3 text-sm text-muted-foreground">
            {catalog ? t("modelPicker.noModels") : t("modelPicker.signInToLoad")}
          </p>
        )}
        {sections.map((section) => {
          if (section.models.length === 0) return null;
          const SectionIcon = section.icon;
          return (
            <section key={section.id} className="space-y-1">
              <div className="flex items-center gap-2 px-2 pt-1 text-xs font-medium text-muted-foreground">
                <SectionIcon className="size-4" stroke={1.8} />
                <span>{section.title}</span>
              </div>
              {section.models.map((model) => {
                const cost = cheapestSellPoints(model);
                const Brand = brandIcon(model);
                const selected = model.id === selectedId;
                const tagline = t(`modelPicker.taglines.${modelTaglineKey(model)}`);
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => {
                      onSelect(model);
                      onClose();
                    }}
                    className={cn(
                      "group block w-full rounded-xl p-2.5 text-left transition-colors hover:bg-white/[0.06]",
                      selected && "bg-white/[0.07]"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                        <Brand className="size-5 text-white/80" stroke={1.7} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{model.name}</span>
                        <span className="mt-0.5 block truncate text-xs leading-5 text-muted-foreground">
                          {tagline}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {cost != null && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <IconBolt className="size-3.5" stroke={1.8} />
                            {cost}
                          </span>
                        )}
                        {selected && <IconCheck className="size-4 text-white" stroke={2} />}
                      </span>
                    </div>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
