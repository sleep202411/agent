"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconBolt,
  IconBrandGoogle,
  IconBrandOpenai,
  IconBrandTiktok,
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

  const models = useMemo(() => {
    // Operation-only models (Upscale / Remove BG / 720°) are reached via their
    // image-toolbar actions, not the general picker.
    const all = (catalog ? usableModelsByModality(catalog, modality) : []).filter(
      (m) => !isOperationOnlyModel(m) && !/hunyuan|panorama/i.test(m.id)
    );
    const q = query.trim().toLowerCase();
    return q ? all.filter((m) => m.name.toLowerCase().includes(q)) : all;
  }, [catalog, modality, query]);

  return (
    <div
      className={cn(
        "nodrag absolute z-50 flex max-h-[460px] w-[380px] flex-col overflow-hidden rounded-2xl bg-[oklch(0.24_0_0)] shadow-2xl shadow-black/60 backdrop-blur-xl",
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

      <div className="nowheel min-h-0 flex-1 overflow-y-auto p-2">
        <div className="px-2 pt-1.5 pb-1.5 text-xs font-medium text-muted-foreground">
          {t("modelPicker.heading")}
        </div>
        {models.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            {catalog ? t("modelPicker.noModels") : t("modelPicker.signInToLoad")}
          </p>
        )}
        {models.map((model) => {
          const cost = cheapestSellPoints(model);
          const Brand = brandIcon(model);
          return (
            <button
              key={model.id}
              type="button"
              onClick={() => {
                onSelect(model);
                onClose();
              }}
              className={cn(
                "group block w-full rounded-xl p-2 text-left transition-colors hover:bg-white/[0.06]",
                model.id === selectedId && "bg-white/[0.06]"
              )}
            >
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                  <Brand className="size-4.5 text-white/80" stroke={1.7} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{model.name}</span>
                {cost != null && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <IconBolt className="size-3.5" stroke={1.8} />
                    {cost}
                  </span>
                )}
              </div>
              {/* Short blurb — slides open on hover (grid-rows 0fr→1fr animates height). */}
              {model.description && (
                <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out group-hover:grid-rows-[1fr]">
                  <div className="overflow-hidden">
                    <p className="line-clamp-1 pt-1 pl-12 text-xs text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      {model.description}
                    </p>
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
