"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { ComposerQuickSettings } from "@/components/canvas/authoring/composer-quick-settings";
import { ModelPicker } from "@/components/canvas/authoring/model-picker";
import {
  defaultSettingsForModel,
  isOperationOnlyModel,
  type FizzAiCatalog,
  type FizzAiModel,
} from "@/lib/canvas-authoring/generation-api";
import { useAiCatalog, usableModelsByModality } from "@/lib/canvas-authoring/use-ai-catalog";
import {
  useStoryProductionSettingsStore,
  type ProductionModality,
} from "../_stores/story-production-settings-store";

/**
 * Prompt-driven generation models only — the same exclusion the ModelPicker
 * applies, so the default-first choice always matches what the picker shows.
 */
function pickableModels(
  catalog: FizzAiCatalog | undefined,
  modality: ProductionModality
): FizzAiModel[] {
  return usableModelsByModality(catalog, modality).filter(
    (model) => !isOperationOnlyModel(model) && !/hunyuan|panorama/i.test(model.id)
  );
}

/**
 * Shared header for the chapter production pages (assets, storyboard, and any
 * future step page): the page title + description on the left, and the
 * page-level generation defaults on the right — one model picker per modality
 * (the canvas ModelPicker, defaulting to the first usable model) with the
 * selected model's schema-driven parameters behind a popover. Every
 * quick-generate on the page submits with these choices.
 */
export function StoryProductionPageHeader({
  title,
  description,
  meta,
  modalities = ["image", "video"],
}: {
  title: string;
  description: string;
  /** Small trailing annotation on the description row (e.g. an item count). */
  meta?: React.ReactNode;
  /** Which generation modalities this page actually submits. */
  modalities?: ProductionModality[];
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-base font-semibold text-white/94">{title}</h1>
        <p className="mt-1 text-xs leading-5 text-white/64">
          {description}
          {meta ? <span className="ml-2 tabular-nums text-white/50">{meta}</span> : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {modalities.map((modality) => (
          <ModalityPicker key={modality} modality={modality} />
        ))}
      </div>
    </div>
  );
}

function ModalityPicker({ modality }: { modality: ProductionModality }) {
  const t = useTranslations("storyStudio.productionHeader");
  const catalog = useAiCatalog();
  const models = pickableModels(catalog.data, modality);
  const entry = useStoryProductionSettingsStore((state) => state[modality]);
  const setModel = useStoryProductionSettingsStore((state) => state.setModel);
  const setOptions = useStoryProductionSettingsStore((state) => state.setOptions);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const selected: FizzAiModel | undefined = entry.selection
    ? models.find((model) => model.id === entry.selection?.modelId)
    : undefined;

  // There is no "auto": the first usable model is the working default the
  // moment the catalog resolves.
  useEffect(() => {
    if (entry.selection || models.length === 0) return;
    const first = models[0];
    setModel(modality, { modelId: first.id, schemaVersion: first.schemaVersion });
    setOptions(modality, defaultSettingsForModel(first));
  }, [entry.selection, models, modality, setModel, setOptions]);

  // The picker closes itself only on selection; outside-pointer and Escape
  // dismissal are the host's job (same contract as the composer).
  useEffect(() => {
    if (!pickerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pickerOpen]);

  const applyModel = (model: FizzAiModel) => {
    setModel(modality, { modelId: model.id, schemaVersion: model.schemaVersion });
    setOptions(modality, defaultSettingsForModel(model));
    setPickerOpen(false);
  };

  return (
    <div className="flex items-center gap-1">
      <div ref={pickerRef} className="relative">
        <button
          type="button"
          aria-label={t(`${modality}Model`)}
          onClick={() => setPickerOpen((open) => !open)}
          className="flex h-9 items-center gap-2 rounded-lg bg-white/[0.06] px-3 text-xs font-medium text-white/88 transition hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
        >
          <span className="shrink-0 text-[10px] font-semibold tracking-[0.08em] text-white/45 uppercase">
            {t(`${modality}Label`)}
          </span>
          <span className="max-w-36 truncate">{selected?.name ?? "…"}</span>
          <IconChevronDown className="size-3.5 shrink-0 text-white/45" stroke={1.8} />
        </button>
        {pickerOpen ? (
          <ModelPicker
            catalog={catalog.data}
            modality={modality}
            selectedId={selected?.id}
            placement="bottom"
            align="right"
            onSelect={applyModel}
            onClose={() => setPickerOpen(false)}
          />
        ) : null}
      </div>
      {selected ? (
        <ComposerQuickSettings
          model={selected}
          settings={entry.options}
          onChange={(next) => setOptions(modality, next)}
          placement="below"
          align="right"
          className="[&>button]:h-9 [&>button]:rounded-lg [&>button]:text-xs"
        />
      ) : null}
    </div>
  );
}
