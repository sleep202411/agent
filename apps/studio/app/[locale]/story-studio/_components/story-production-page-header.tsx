"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { ComposerQuickSettings } from "@/components/canvas/authoring/composer-quick-settings";
import { ModelPicker } from "@/components/canvas/authoring/model-picker";
import { defaultSettingsForModel, type FizzAiModel } from "@/lib/canvas-authoring/generation-api";
import {
  EMPTY_PRODUCTION_MODALITY_SETTINGS,
  useStoryProductionSettingsStore,
  type ProductionModality,
} from "../_stores/story-production-settings-store";
import { useStoryProductionGenerationDefaults } from "./use-story-production-generation-defaults";

/**
 * Shared header for the chapter production pages (assets, storyboard, and any
 * future step page): the page title + description on the left, and the
 * page-level generation defaults on the right — one model picker per modality
 * (the canvas ModelPicker, defaulting to the first usable model) with the
 * selected model's schema-driven parameters behind a popover. Every
 * quick-generate on the page submits with these choices.
 */
export function StoryProductionPageHeader({
  projectId,
  title,
  description,
  meta,
  actions,
  modalities = ["image", "video"],
  showGenerationControls = true,
}: {
  projectId: string;
  title: string;
  description: string;
  /** Small trailing annotation on the description row (e.g. an item count). */
  meta?: React.ReactNode;
  /** Creator actions that remain available independently of AI generation. */
  actions?: React.ReactNode;
  /** Which generation modalities this page actually submits. */
  modalities?: ProductionModality[];
  /** Hide model controls until there is an approved, generatable target. */
  showGenerationControls?: boolean;
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
      {actions || showGenerationControls ? (
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {showGenerationControls ? (
            <StoryProductionGenerationControls projectId={projectId} modalities={modalities} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function StoryProductionGenerationControls({
  projectId,
  modalities = ["image", "video"],
}: {
  projectId: string;
  modalities?: ProductionModality[];
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {modalities.map((modality) => (
        <ModalityPicker key={modality} projectId={projectId} modality={modality} />
      ))}
    </div>
  );
}

function ModalityPicker({
  projectId,
  modality,
}: {
  projectId: string;
  modality: ProductionModality;
}) {
  const t = useTranslations("storyStudio.productionHeader");
  const defaults = useStoryProductionGenerationDefaults(projectId, modality);
  const models = defaults.models;
  const entry = useStoryProductionSettingsStore(
    (state) => state.byProject[projectId]?.[modality] ?? EMPTY_PRODUCTION_MODALITY_SETTINGS
  );
  const setModel = useStoryProductionSettingsStore((state) => state.setModel);
  const setOptions = useStoryProductionSettingsStore((state) => state.setOptions);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const selected: FizzAiModel | undefined = defaults.model;

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
    setModel(projectId, modality, { modelId: model.id, schemaVersion: model.schemaVersion });
    setOptions(projectId, modality, defaultSettingsForModel(model));
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
            catalog={{ models }}
            modality={modality}
            selectedId={selected?.id}
            placement="bottom"
            // Opens rightward: the trigger sits at the left of the toolbar, so
            // hanging the panel off its right edge would send it under the rail.
            align="left"
            onSelect={applyModel}
            onClose={() => setPickerOpen(false)}
          />
        ) : null}
      </div>
      {selected ? (
        <ComposerQuickSettings
          model={selected}
          settings={entry.options}
          onChange={(next) => setOptions(projectId, modality, next)}
          placement="below"
          align="right"
          className="[&>button]:h-9 [&>button]:rounded-lg [&>button]:text-xs"
        />
      ) : null}
    </div>
  );
}
