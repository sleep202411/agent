"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconAdjustments,
  IconArrowUp,
  IconBolt,
  IconChevronDown,
  IconLoader2,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useDismiss } from "@/lib/use-dismiss";
import {
  modeLabel,
  type FizzAiCatalog,
  type FizzAiModel,
  type FizzAiReferenceFieldConstraints,
  type ModelSettings as ModelSettingsBag,
} from "@/app/[locale]/canvas/_lib/generation-api";
import { ModelPicker } from "@/app/[locale]/canvas/_components/model-picker";
import { ModelSettings as ModelSettingsPanel } from "@/app/[locale]/canvas/_components/model-settings";
import { ModeMenu } from "@/app/[locale]/canvas/_components/mode-menu";
import { ReferenceFan } from "./reference-fan";
import type { ReferenceUpload } from "./use-reference-uploads";
import { MentionMenu, mentionRange, type MentionItem } from "@/lib/prompt-mentions";

/**
 * Bottom-docked composer for the image / video studio pages: prompt as the
 * hero, references fanned at its left, parameters in popover pills
 * (mode · model · settings), live credit cost next to Create.
 * Cmd/Ctrl+Enter submits; `@` mentions reference uploads.
 */
export function StudioComposer({
  modality,
  catalog,
  prompt,
  onPromptChange,
  model,
  onSelectModel,
  settings,
  onSettingsChange,
  mode,
  modes = [],
  onSelectMode,
  referenceFields,
  referenceItems,
  onAddReferences,
  onRemoveReference,
  cost,
  canSubmit,
  submitting,
  error,
  onSubmit,
}: {
  modality: "image" | "video";
  catalog: FizzAiCatalog | undefined;
  prompt: string;
  onPromptChange: (value: string) => void;
  model: FizzAiModel | undefined;
  onSelectModel: (model: FizzAiModel) => void;
  settings: ModelSettingsBag;
  onSettingsChange: (next: ModelSettingsBag) => void;
  mode?: string;
  modes?: string[];
  onSelectMode?: (mode: string) => void;
  referenceFields: FizzAiReferenceFieldConstraints[];
  referenceItems: ReferenceUpload[];
  onAddReferences: (field: FizzAiReferenceFieldConstraints, files: File[]) => void;
  onRemoveReference: (id: string) => void;
  cost: number | null;
  canSubmit: boolean;
  submitting: boolean;
  error?: string | null;
  onSubmit: () => void;
}) {
  const t = useTranslations("generation");
  const tc = useTranslations("common");
  const [panel, setPanel] = useState<"model" | "settings" | "mode" | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useDismiss(panel !== null, () => setPanel(null));

  const showReferences = referenceFields.length > 0;
  const mentionables = useMemo(
    () => referenceItems.filter((item) => !item.uploading && !item.error),
    [referenceItems]
  );

  const currentMention = () => {
    const el = textareaRef.current;
    if (!el) return null;
    return mentionRange(prompt, el.selectionStart ?? prompt.length);
  };
  const updateMentionState = (value: string, caret: number) => {
    const range = mentionRange(value, caret);
    setMentionOpen(Boolean(range));
    setMentionActive(0);
    setMentionQuery(range?.query.toLowerCase() ?? "");
  };
  const mentionOptions = useMemo(() => {
    if (!mentionOpen) return [];
    return mentionables.filter(
      (item) =>
        !mentionQuery ||
        item.label.toLowerCase().includes(mentionQuery) ||
        item.name.toLowerCase().includes(mentionQuery)
    );
  }, [mentionOpen, mentionQuery, mentionables]);

  const insertMention = (item: MentionItem) => {
    const el = textareaRef.current;
    const range = currentMention();
    if (!el || !range) return;
    const caret = el.selectionStart ?? prompt.length;
    const before = prompt.slice(0, range.start);
    const after = prompt.slice(caret);
    const next = `${before}@${item.label} ${after}`;
    onPromptChange(next);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const position = before.length + item.label.length + 2;
      el.setSelectionRange(position, position);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && mentionOptions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setMentionActive((index) => {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          return (index + delta + mentionOptions.length) % mentionOptions.length;
        });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        insertMention(mentionOptions[mentionActive]);
        return;
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        setMentionOpen(false);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSubmit) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-5 z-40 lg:left-[104px]">
      <div className="pointer-events-auto mx-auto w-full max-w-[760px] rounded-3xl bg-[oklch(0.22_0_0_/_0.92)] p-4 shadow-[0_24px_70px_-12px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl backdrop-saturate-150">
        {/* Prompt + fanned references */}
        <div className="relative">
          {showReferences && (
            <div className="absolute top-0 left-0 z-10">
              <ReferenceFan
                fields={referenceFields}
                items={referenceItems}
                onAdd={onAddReferences}
                onRemove={onRemoveReference}
              />
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={prompt}
            maxLength={800}
            rows={3}
            placeholder={t("promptPlaceholder")}
            onChange={(event) => {
              onPromptChange(event.target.value);
              updateMentionState(
                event.target.value,
                event.target.selectionStart ?? event.target.value.length
              );
            }}
            onSelect={(event) =>
              updateMentionState(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? event.currentTarget.value.length
              )
            }
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setMentionOpen(false), 120)}
            className={cn(
              "block max-h-40 w-full resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground",
              showReferences && "min-h-[80px] pl-[150px]",
              showReferences && referenceItems.length > 1 && "pl-[190px]"
            )}
          />
          {mentionOpen && (
            <div
              className={cn("absolute", showReferences ? "left-[150px]" : "left-0")}
              data-popover-zone
            >
              <MentionMenu
                options={mentionOptions}
                active={mentionActive}
                onPick={insertMention}
                className="top-9 left-0"
              />
            </div>
          )}
        </div>

        {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}

        {/* Controls row */}
        <div className="mt-3 flex items-center gap-1.5">
          {modes.length > 1 && onSelectMode && (
            <div className="relative" data-popover-zone>
              <button
                type="button"
                onClick={() => setPanel((p) => (p === "mode" ? null : "mode"))}
                className="flex h-8 items-center gap-1 rounded-full bg-white/[0.06] px-3 text-xs font-medium transition-colors hover:bg-white/[0.1]"
              >
                {mode ? modeLabel(mode) : t("mode")}
                <IconChevronDown className="size-3.5 text-muted-foreground" stroke={2} />
              </button>
              {panel === "mode" && (
                <ModeMenu
                  modes={modes}
                  value={mode}
                  onSelect={(m) => onSelectMode(m)}
                  onClose={() => setPanel(null)}
                />
              )}
            </div>
          )}

          <div className="relative" data-popover-zone>
            <button
              type="button"
              onClick={() => setPanel((p) => (p === "model" ? null : "model"))}
              className="flex h-8 items-center rounded-full bg-white/[0.06] px-3 text-xs font-medium transition-colors hover:bg-white/[0.1]"
            >
              {model?.name ?? t("chooseModel")}
            </button>
            {panel === "model" && (
              <ModelPicker
                catalog={catalog}
                modality={modality}
                selectedId={model?.id}
                onSelect={onSelectModel}
                onClose={() => setPanel(null)}
              />
            )}
          </div>

          <div className="relative" data-popover-zone>
            <button
              type="button"
              aria-label={t("settings")}
              onClick={() => setPanel((p) => (p === "settings" ? null : "settings"))}
              className="flex size-8 items-center justify-center rounded-full bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
            >
              <IconAdjustments className="size-4" stroke={1.8} />
            </button>
            {panel === "settings" && (
              <ModelSettingsPanel model={model} settings={settings} onChange={onSettingsChange} />
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {cost != null && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                <IconBolt className="size-3.5" stroke={1.8} />
                {cost}
              </span>
            )}
            <button
              type="button"
              aria-label={tc("create")}
              disabled={!canSubmit}
              onClick={onSubmit}
              // Brand red as the hero CTA — sanctioned case-by-case accent
              // (DESIGN.md rule 3), applied locally, never a token.
              className="flex h-9 items-center gap-1.5 rounded-full bg-[#E52227] px-4 text-sm font-semibold text-white shadow-lg shadow-[#E52227]/25 transition-colors hover:bg-[#c91e22] disabled:opacity-40"
            >
              {submitting ? (
                <IconLoader2 className="size-4 animate-spin" stroke={2} />
              ) : (
                <IconArrowUp className="size-4" stroke={2.2} />
              )}
              {tc("create")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
