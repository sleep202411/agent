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
import { GlassRim } from "@/components/ui/glass-rim";
import { useDismiss } from "@/lib/use-dismiss";
import {
  enumOptions,
  stringMaxLength,
  type FizzAiCatalog,
  type FizzAiModel,
  type FizzAiReferenceFieldConstraints,
  type ModelSettings as ModelSettingsBag,
  type ValidationIssue,
} from "@/lib/canvas-authoring/generation-api";
import {
  applyOmniModeSelection,
  lockedSettingFields,
  menuValueForMode,
  modeMenuValues,
  OMNI_TASK_TYPE_FIELD,
} from "@/lib/canvas-authoring/omni-task-modes";
import { useComposerModeLabel } from "@/lib/canvas-authoring/use-labels";
import { ModelPicker } from "@/components/canvas/authoring/model-picker";
import {
  hasRenderableModelSettings,
  ModelSettings as ModelSettingsPanel,
} from "@/components/canvas/authoring/model-settings";
import { ComposerQuickSettings } from "@/components/canvas/authoring/composer-quick-settings";
import { ModeMenu } from "@/components/canvas/authoring/mode-menu";
import { ValidationAlertDialog } from "@/components/canvas/authoring/validation-alert-dialog";
import { ReferenceFan } from "./reference-fan";
import type { ReferenceUpload } from "./use-reference-uploads";
import {
  MentionMenu,
  PromptMentionMirror,
  insertMentionText,
  mentionRange,
  removeMentionText,
  textareaMentionMenuPosition,
  type MentionItem,
} from "@/lib/prompt-mentions";
import { useAuth } from "@/app/_components/auth-provider";

/**
 * Bottom-docked composer for the image / video studio pages: prompt as the
 * hero, references fanned at its left, parameters in popover pills
 * (model · mode · settings), live credit cost next to Create.
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
  validationIssues,
  onDismissValidation,
  onSubmit,
  onRequestSubmit,
  docked = true,
  submitOnEnter = false,
}: {
  modality: "image" | "video" | "audio";
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
  /** Catalog-driven preflight issues (Alert Dialog). */
  validationIssues?: ValidationIssue[];
  /** Clear parent validation / error state when the dialog closes. */
  onDismissValidation?: () => void;
  onSubmit: () => void;
  /** Host may wait for authenticated workspace hydration before resuming. */
  onRequestSubmit?: () => void;
  /** Bottom-docked (feed pages) vs in-flow (e.g. the home hero). */
  docked?: boolean;
  submitOnEnter?: boolean;
}) {
  const t = useTranslations("generation");
  const tc = useTranslations("common");
  const [panel, setPanel] = useState<"model" | "settings" | "mode" | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionMenuStyle, setMentionMenuStyle] = useState<React.CSSProperties | undefined>();
  const [promptScrollTop, setPromptScrollTop] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const promptAreaRef = useRef<HTMLDivElement>(null);
  useDismiss(panel !== null, () => setPanel(null));

  const { requireAuth } = useAuth();
  // Generation is public to browse but gated to run: prompt sign-in on submit
  // when signed out, then resume the submit on success.
  const gatedSubmit = () => (onRequestSubmit ? onRequestSubmit() : requireAuth(onSubmit));

  /** Mode-menu selection, including the UI-only omni sub-intent entries:
   *  `multimodal_to_video::edit` maps to mode + task type (+ parameter locks)
   *  in one change. Any non-composite selection (including plain Omni
   *  Reference) resets the task type to auto. */
  const selectMode = (value: string) => {
    const { mode: nextMode, settings: next } = applyOmniModeSelection(value, settings);
    onSettingsChange(next);
    onSelectMode?.(nextMode);
  };

  const validationOpen = Boolean(validationIssues && validationIssues.length > 0);
  const showReferences = referenceFields.length > 0;
  const showSettingsButton = useMemo(() => hasRenderableModelSettings(model, true), [model]);
  // Seedance 2.5 task types (omni_reference_task_type) surface as extra
  // mode-menu entries right after Omni Reference. Composite values are
  // UI-only; selection maps back to mode + settings in selectMode.
  const omniTaskTypes = model ? enumOptions(model, OMNI_TASK_TYPE_FIELD) : null;
  const omniTaskValue =
    typeof settings.omniReferenceTaskType === "string" ? settings.omniReferenceTaskType : "auto";
  const cl = useComposerModeLabel();
  const menuModes = modeMenuValues(modes, omniTaskTypes);
  const menuValue = menuValueForMode(mode, omniTaskValue);
  const lockedFields = lockedSettingFields(omniTaskValue);
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
    if (range && textareaRef.current && promptAreaRef.current) {
      setMentionMenuStyle(
        textareaMentionMenuPosition(textareaRef.current, promptAreaRef.current, range.start)
      );
    } else {
      setMentionMenuStyle(undefined);
    }
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
    if (!el || !currentMention()) return;
    const caret = el.selectionStart ?? prompt.length;
    const inserted = insertMentionText(prompt, caret, item);
    if (!inserted) return;
    onPromptChange(inserted.value);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(inserted.caret, inserted.caret);
    });
  };

  const removeMention = (range: { end: number; start: number }) => {
    const el = textareaRef.current;
    const removed = removeMentionText(prompt, range);
    onPromptChange(removed.value);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(removed.caret, removed.caret);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat) return;
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
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      (submitOnEnter || event.metaKey || event.ctrlKey) &&
      canSubmit
    ) {
      event.preventDefault();
      gatedSubmit();
    }
  };

  const promptTextClassName = cn(
    "block max-h-40 w-full resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground",
    showReferences && "min-h-[80px] pl-[150px]",
    showReferences && referenceItems.length > 1 && "pl-[190px]"
  );

  const shell = (
    <div className="pointer-events-auto relative mx-auto w-full max-w-[1120px] rounded-3xl bg-[oklch(0.22_0_0_/_0.92)] p-4 shadow-[0_24px_70px_-12px_rgba(0,0,0,0.7)] backdrop-blur-2xl backdrop-saturate-150">
      {/* signature glass rim-light (DESIGN.md §3.2) */}
      <GlassRim />
      {/* Prompt + fanned references */}
      <div ref={promptAreaRef} className="relative">
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
        {mentionables.length > 0 && (
          <PromptMentionMirror
            value={prompt}
            mentions={mentionables}
            onRemoveMention={removeMention}
            scrollTop={promptScrollTop}
            className={promptTextClassName}
          />
        )}
        <textarea
          ref={textareaRef}
          aria-label={t("promptPlaceholder")}
          value={prompt}
          maxLength={stringMaxLength(model, "prompt")}
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
          onScroll={(event) => {
            setPromptScrollTop(event.currentTarget.scrollTop);
            updateMentionState(
              event.currentTarget.value,
              event.currentTarget.selectionStart ?? event.currentTarget.value.length
            );
          }}
          onBlur={() => setTimeout(() => setMentionOpen(false), 120)}
          className={cn(
            promptTextClassName,
            "relative z-[1]",
            mentionables.length > 0 &&
              prompt &&
              "text-transparent caret-white selection:bg-sky-500/35"
          )}
        />
        {mentionOpen && (
          <MentionMenu
            options={mentionOptions}
            active={mentionActive}
            onPick={insertMention}
            className="top-0 left-0"
            style={mentionMenuStyle}
          />
        )}
      </div>

      <ValidationAlertDialog
        open={validationOpen}
        onOpenChange={(open) => {
          if (!open) onDismissValidation?.();
        }}
        title={t("validationBlockedTitle")}
        issues={validationIssues}
        formatIssue={t}
      />
      <ValidationAlertDialog
        open={!validationOpen && Boolean(error)}
        onOpenChange={(open) => {
          if (!open) onDismissValidation?.();
        }}
        title={t("validationBlockedTitle")}
        message={error}
      />

      {/* Controls row */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <div className="relative" data-popover-zone>
          <button
            type="button"
            onClick={() => setPanel((p) => (p === "model" ? null : "model"))}
            className="flex h-10 items-center rounded-xl bg-white/[0.08] px-3 text-sm font-medium transition-colors hover:bg-white/[0.12]"
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

        {/* Mode pill: always shown when the model exposes a mode (so the
              current mode is visible); interactive only when there's >1.
              Seedance 2.5 omni sub-intents (edit/extend) live in the same
              menu — the pill itself reads "Edit Video" while the underlying
              mode stays multimodal_to_video. */}
        {modes.length >= 1 && mode && (
          <div className="relative" data-popover-zone>
            <button
              type="button"
              onClick={
                modes.length > 1 && onSelectMode
                  ? () => setPanel((p) => (p === "mode" ? null : "mode"))
                  : undefined
              }
              className={cn(
                "flex h-10 items-center gap-1 whitespace-nowrap rounded-xl bg-white/[0.08] px-3 text-sm font-medium transition-colors",
                modes.length > 1 ? "hover:bg-white/[0.12]" : "cursor-default"
              )}
            >
              {cl(menuValue ?? "")}
              {modes.length > 1 ? (
                <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" stroke={2} />
              ) : null}
            </button>
            {panel === "mode" && modes.length > 1 && onSelectMode && (
              <ModeMenu
                modes={menuModes}
                value={menuValue}
                onSelect={selectMode}
                onClose={() => setPanel(null)}
                labelFor={cl}
              />
            )}
          </div>
        )}

        <ComposerQuickSettings
          model={model}
          settings={settings}
          onChange={onSettingsChange}
          lockedFields={lockedFields}
        />

        {showSettingsButton && (
          <div className="relative" data-popover-zone>
            <button
              type="button"
              aria-label={t("settings")}
              onClick={() => setPanel((p) => (p === "settings" ? null : "settings"))}
              className="flex size-10 items-center justify-center rounded-xl bg-white/[0.08] text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
            >
              <IconAdjustments className="size-4.5" stroke={1.8} />
            </button>
            {panel === "settings" && (
              <ModelSettingsPanel
                model={model}
                settings={settings}
                onChange={onSettingsChange}
                hideQuickFields
                lockedFields={lockedFields}
              />
            )}
          </div>
        )}

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
            onClick={gatedSubmit}
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
  );

  return docked ? (
    <div className="pointer-events-none fixed inset-x-4 bottom-5 z-40 transition-[left] duration-200 lg:left-[calc(var(--studio-sidebar-width)+1rem)]">
      {shell}
    </div>
  ) : (
    shell
  );
}
