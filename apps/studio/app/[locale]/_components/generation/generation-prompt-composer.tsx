"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  IconAdjustments,
  IconArrowUp,
  IconArrowsDiagonal2,
  IconArrowsDiagonalMinimize2,
  IconBolt,
  IconChevronDown,
  IconPhoto,
  IconLoader2,
  IconPuzzle,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import type { MentionItem, SkillMarketItem } from "@/lib/prompt-mentions";
import { cn } from "@/lib/utils";
import {
  enumOptions,
  stringMaxLength,
  type FizzAiCatalog,
  type FizzAiModel,
  type ModelSettings,
} from "@/lib/canvas-authoring/generation-api";
import {
  applyOmniModeSelection,
  lockedSettingFields,
  menuValueForMode,
  modeMenuValues,
  OMNI_TASK_TYPE_FIELD,
} from "@/lib/canvas-authoring/omni-task-modes";
import { useComposerModeLabel } from "@/lib/canvas-authoring/use-labels";
import { useDismiss } from "@/lib/use-dismiss";
import { ComposerQuickSettings } from "@/components/canvas/authoring/composer-quick-settings";
import { ModeMenu } from "@/components/canvas/authoring/mode-menu";
import { ModelPicker } from "@/components/canvas/authoring/model-picker";
import type { StudioModality } from "@/lib/canvas-authoring/use-ai-catalog";
import {
  hasRenderableModelSettings,
  ModelSettings as ModelSettingsPanel,
} from "@/components/canvas/authoring/model-settings";
import {
  PromptTextarea,
  type PromptTextareaHandle,
} from "@/components/canvas/authoring/prompt-textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { IconAudioWaveform } from "@/components/icons/icon-audio-waveform";

gsap.registerPlugin(useGSAP);

export type GenerationPromptComposerPanel = "model" | "settings" | "mode" | null;

/**
 * The single node-level Prompt Composer used by every creative canvas.
 *
 * It owns presentation and model controls only. Callers retain their domain
 * semantics: the general Canvas submits an AiJob, while Story Studio submits a
 * immutable input-snapshot video generation through its own adapter.
 */
export function GenerationPromptComposer({
  ariaLabel,
  modality,
  catalog,
  model,
  modelFallbackLabel,
  onSelectModel,
  modelPickerEnabled = true,
  prompt,
  onPromptCommit,
  promptPlaceholder,
  promptAriaLabel,
  promptHint,
  promptReadOnly = false,
  promptAutoFocus = false,
  promptRows = 4,
  showPrompt = true,
  mentions,
  skillMarketOptions,
  skillMarketLoading = false,
  skillMarketError = false,
  onMentionActivate,
  onSkillMarketRetry,
  onOpenSkillMarket,
  referenceContent,
  mode,
  modes = [],
  onSelectMode,
  modePickerEnabled = true,
  fixedControls,
  trailingControls,
  settings,
  onSettingsChange,
  settingsEnabled = true,
  panel,
  onPanelChange,
  onQuickSettingsOpenChange,
  cost,
  canSubmit,
  submitting,
  onSubmit,
  onCancel,
  submitLabel,
  submittingLabel,
  cancelLabel,
  disabledReason,
  error,
  className,
}: {
  ariaLabel?: string;
  modality: StudioModality;
  catalog: FizzAiCatalog | undefined;
  model: FizzAiModel | undefined;
  modelFallbackLabel?: string;
  onSelectModel?: (model: FizzAiModel) => void;
  modelPickerEnabled?: boolean;
  prompt: string;
  onPromptCommit: (next: string) => void;
  promptPlaceholder?: string;
  promptAriaLabel?: string;
  promptHint?: string;
  promptReadOnly?: boolean;
  promptAutoFocus?: boolean;
  promptRows?: number;
  showPrompt?: boolean;
  mentions?: readonly MentionItem[];
  skillMarketOptions?: readonly SkillMarketItem[];
  skillMarketLoading?: boolean;
  skillMarketError?: boolean;
  onMentionActivate?: (mention: MentionItem) => void;
  onSkillMarketRetry?: () => void;
  onOpenSkillMarket?: (catalogId: string, applySkill: (item: MentionItem) => void) => void;
  referenceContent?: ReactNode;
  mode?: string;
  modes?: string[];
  onSelectMode?: (mode: string) => void;
  modePickerEnabled?: boolean;
  fixedControls?: ReactNode;
  /** Rendered after the mode/model/settings pickers, before the cost group. */
  trailingControls?: ReactNode;
  settings: ModelSettings;
  onSettingsChange?: (next: ModelSettings) => void;
  settingsEnabled?: boolean;
  panel: GenerationPromptComposerPanel;
  onPanelChange: (panel: GenerationPromptComposerPanel) => void;
  onQuickSettingsOpenChange?: (open: boolean) => void;
  cost: number | null;
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  submitLabel: string;
  submittingLabel?: string;
  cancelLabel?: string;
  disabledReason?: string | null;
  error?: string | null;
  className?: string;
}) {
  const t = useTranslations("canvasOps");
  const tg = useTranslations("generation");
  useDismiss(panel !== null, () => onPanelChange(null));
  const modeTriggerRef = useRef<HTMLButtonElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const expandTriggerRef = useRef<HTMLButtonElement>(null);
  const expandedSurfaceRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<PromptTextareaHandle>(null);
  const disabledReasonId = useId();
  const [expanded, setExpanded] = useState(false);

  const modelControlVisible = modelPickerEnabled && Boolean(onSelectModel);
  const modeControlVisible = modePickerEnabled && modes.length > 1 && Boolean(onSelectMode);
  const settingsControlVisible = settingsEnabled && Boolean(onSettingsChange);
  const hasAdvancedSettings = settingsControlVisible && hasRenderableModelSettings(model, true);
  // Seedance 2.5 task types (omni_reference_task_type) surface as extra
  // mode-menu entries right after Omni Reference. Composite values are
  // UI-only; selection maps back to mode + settings in selectMode.
  const omniTaskTypes =
    settingsControlVisible && model ? enumOptions(model, OMNI_TASK_TYPE_FIELD) : null;
  const omniTaskValue =
    typeof settings.omniReferenceTaskType === "string" ? settings.omniReferenceTaskType : "auto";
  const cl = useComposerModeLabel();
  const menuModes = modeControlVisible ? modeMenuValues(modes, omniTaskTypes) : modes;
  const menuValue = menuValueForMode(mode, omniTaskValue);
  const lockedFields = lockedSettingFields(omniTaskValue);
  const busy = submitting;
  const actionDisabled = busy ? !onCancel : !canSubmit;
  const actionLabel = busy
    ? onCancel
      ? (cancelLabel ?? submitLabel)
      : (submittingLabel ?? submitLabel)
    : submitLabel;
  const skillPickerVisible =
    skillMarketOptions !== undefined || Boolean(mentions?.some((item) => item.kind === "skill"));

  /** Mode-menu selection, including the UI-only omni sub-intent entries:
   *  `multimodal_to_video::edit` maps to mode + task type (+ parameter locks)
   *  in one change. Any non-composite selection (including plain Omni
   *  Reference) resets the task type to auto. */
  const selectMode = (value: string) => {
    const { mode: nextMode, settings: next } = applyOmniModeSelection(value, settings);
    if (settingsControlVisible) onSettingsChange?.(next);
    onSelectMode?.(nextMode);
  };

  const closePanelAndRestoreFocus = (
    closingPanel: Exclude<GenerationPromptComposerPanel, null>
  ) => {
    onPanelChange(null);
    requestAnimationFrame(() => {
      const trigger =
        closingPanel === "mode"
          ? modeTriggerRef.current
          : closingPanel === "model"
            ? modelTriggerRef.current
            : settingsTriggerRef.current;
      trigger?.focus();
    });
  };

  const setExpandedPresentation = (next: boolean) => {
    onPanelChange(null);
    onQuickSettingsOpenChange?.(false);
    setExpanded(next);
  };

  useEffect(() => {
    if (!expanded) return;

    const onExpandedKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (panel !== null) {
        const closingPanel = panel;
        onPanelChange(null);
        requestAnimationFrame(() => {
          const trigger =
            closingPanel === "mode"
              ? modeTriggerRef.current
              : closingPanel === "model"
                ? modelTriggerRef.current
                : settingsTriggerRef.current;
          trigger?.focus();
        });
        return;
      }

      onQuickSettingsOpenChange?.(false);
      setExpanded(false);
    };

    window.addEventListener("keydown", onExpandedKeyDown, true);
    return () => window.removeEventListener("keydown", onExpandedKeyDown, true);
  }, [expanded, onPanelChange, onQuickSettingsOpenChange, panel]);

  useGSAP(
    () => {
      if (!expanded || !expandedSurfaceRef.current) return;
      const media = gsap.matchMedia();

      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          expandedSurfaceRef.current,
          {
            autoAlpha: 0,
            scale: 0.965,
            y: 18,
          },
          {
            autoAlpha: 1,
            clearProps: "transform,opacity,visibility",
            duration: 0.32,
            ease: "power3.out",
            scale: 1,
            y: 0,
          }
        );
      });

      media.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(expandedSurfaceRef.current, { autoAlpha: 1 });
      });

      return () => media.revert();
    },
    {
      dependencies: [expanded],
      revertOnUpdate: true,
      scope: expandedSurfaceRef,
    }
  );

  const ModalityIcon =
    modality === "image" ? IconPhoto : modality === "video" ? IconVideo : IconAudioWaveform;
  const expandedTitle =
    modality === "image"
      ? t("expandedComposer.imageTitle")
      : modality === "video"
        ? t("expandedComposer.videoTitle")
        : t("expandedComposer.audioTitle");

  const renderComposer = (presentation: "compact" | "expanded") => {
    const isExpanded = presentation === "expanded";

    return (
      <section
        data-generation-composer={presentation}
        className={cn(
          "nodrag nopan nowheel nokey",
          isExpanded
            ? "flex size-full min-h-0 flex-col"
            : "relative w-[800px] max-w-[calc(100vw-2rem)] rounded-3xl bg-white/[0.05] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-3xl backdrop-saturate-200",
          className
        )}
        aria-label={ariaLabel}
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          if (panel === null) return;
          closePanelAndRestoreFocus(panel);
        }}
      >
        {isExpanded ? (
          <header className="flex h-16 shrink-0 items-center gap-3 px-6">
            <span className="flex size-9 items-center justify-center rounded-xl bg-white/[0.06] text-white/70">
              <ModalityIcon className="size-4.5" stroke={1.7} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-medium text-white/90">
                {expandedTitle}
              </DialogTitle>
              <p className="truncate text-xs text-white/40">
                {model?.name ?? modelFallbackLabel ?? t("selectModel")}
              </p>
            </div>
            <button
              type="button"
              aria-label={t("expandedComposer.collapse")}
              onClick={() => setExpandedPresentation(false)}
              className="ml-auto inline-flex size-9 items-center justify-center rounded-xl bg-white/[0.06] text-white/55 transition hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
            >
              <IconArrowsDiagonalMinimize2 className="size-4" stroke={1.8} />
            </button>
          </header>
        ) : (
          <button
            ref={expandTriggerRef}
            type="button"
            aria-label={t("expandedComposer.expand")}
            onClick={() => setExpandedPresentation(true)}
            className="absolute top-4 right-4 z-10 inline-flex size-8 items-center justify-center rounded-lg bg-white/[0.06] text-white/55 transition hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
          >
            <IconArrowsDiagonal2 className="size-3.5" stroke={1.8} />
          </button>
        )}

        <div
          className={cn(
            isExpanded
              ? "mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 flex-col px-6 pb-6"
              : "w-full"
          )}
        >
          <div className={cn(isExpanded ? "min-h-0 flex-1" : "pr-10")}>
            {skillPickerVisible ? (
              <div
                data-composer-action-row=""
                className="mb-2 flex min-h-9 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <button
                  type="button"
                  onClick={() => promptTextareaRef.current?.openSkillPicker()}
                  className="ring-brand-yellow/25 hover:bg-brand-yellow/[0.055] hover:ring-brand-yellow/45 inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-transparent px-3 text-xs font-medium text-white/68 ring-1 ring-inset transition-colors hover:text-white/92 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
                  aria-label={tg("chooseSkill")}
                >
                  <IconPuzzle className="text-brand-yellow size-3.5" stroke={1.8} />
                  <span>{tg("chooseSkill")}</span>
                </button>
              </div>
            ) : null}

            {referenceContent}

            {showPrompt ? (
              <div>
                <PromptTextarea
                  ref={promptTextareaRef}
                  value={prompt}
                  onCommit={onPromptCommit}
                  mentions={mentions}
                  skillMarketOptions={skillMarketOptions}
                  skillMarketLoading={skillMarketLoading}
                  skillMarketError={skillMarketError}
                  onMentionActivate={onMentionActivate}
                  onSkillMarketRetry={onSkillMarketRetry}
                  onOpenSkillMarket={onOpenSkillMarket}
                  placeholder={promptPlaceholder}
                  aria-label={promptAriaLabel}
                  rows={isExpanded ? Math.max(promptRows, 10) : promptRows}
                  maxLength={stringMaxLength(model, "prompt")}
                  autoFocus={isExpanded || promptAutoFocus}
                  readOnly={promptReadOnly}
                  className={cn(
                    "block w-full resize-none overflow-y-auto overscroll-contain outline-none placeholder:text-muted-foreground",
                    isExpanded
                      ? "max-h-[calc(100dvh-23rem)] bg-transparent pb-2 text-sm leading-6"
                      : "max-h-40 bg-transparent pb-2 text-sm leading-6"
                  )}
                />
                {promptHint ? (
                  <p className="mt-1 text-[10px] leading-4 text-white/32">{promptHint}</p>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p
                className="mt-1.5 text-xs leading-5 text-destructive"
                role="alert"
                aria-live="polite"
              >
                {error}
              </p>
            ) : null}
          </div>

          <div
            className={cn(
              "flex min-h-10 flex-wrap items-center gap-2 pt-2",
              isExpanded && "mt-4 shrink-0"
            )}
          >
            {fixedControls}

            {modelControlVisible ? (
              <div className="relative" data-popover-zone>
                <button
                  ref={modelTriggerRef}
                  type="button"
                  onClick={() => onPanelChange(panel === "model" ? null : "model")}
                  aria-haspopup="dialog"
                  aria-expanded={panel === "model"}
                  className="flex h-10 max-w-[220px] items-center gap-1 rounded-xl bg-white/[0.08] px-3 text-sm font-medium transition-colors hover:bg-white/[0.12]"
                >
                  <span className="truncate">
                    {model?.name ?? modelFallbackLabel ?? t("selectModel")}
                  </span>
                  <IconChevronDown
                    className="size-3.5 shrink-0 text-muted-foreground"
                    stroke={1.8}
                  />
                </button>
                {panel === "model" ? (
                  <ModelPicker
                    catalog={catalog}
                    modality={modality}
                    selectedId={model?.id}
                    onSelect={(nextModel) => onSelectModel?.(nextModel)}
                    onClose={() => closePanelAndRestoreFocus("model")}
                  />
                ) : null}
              </div>
            ) : null}

            {modeControlVisible ? (
              <div className="relative" data-popover-zone>
                <button
                  ref={modeTriggerRef}
                  type="button"
                  onClick={() => onPanelChange(panel === "mode" ? null : "mode")}
                  aria-haspopup="menu"
                  aria-expanded={panel === "mode"}
                  className="flex h-10 items-center gap-1 whitespace-nowrap rounded-xl bg-white/[0.08] px-3 text-sm font-medium transition-colors hover:bg-white/[0.12]"
                >
                  {cl(menuValue ?? "")}
                  <IconChevronDown
                    className="size-3.5 shrink-0 text-muted-foreground"
                    stroke={1.8}
                  />
                </button>
                {panel === "mode" ? (
                  <ModeMenu
                    modes={menuModes}
                    value={menuValue}
                    onSelect={selectMode}
                    onClose={() => closePanelAndRestoreFocus("mode")}
                    labelFor={cl}
                  />
                ) : null}
              </div>
            ) : null}

            {settingsControlVisible ? (
              <ComposerQuickSettings
                model={model}
                settings={settings}
                onChange={(next) => onSettingsChange?.(next)}
                onOpenChange={onQuickSettingsOpenChange}
                lockedFields={lockedFields}
              />
            ) : null}

            {trailingControls}

            {hasAdvancedSettings ? (
              <div className="relative" data-popover-zone>
                <button
                  ref={settingsTriggerRef}
                  type="button"
                  onClick={() => onPanelChange(panel === "settings" ? null : "settings")}
                  aria-haspopup="dialog"
                  aria-expanded={panel === "settings"}
                  className="flex size-10 items-center justify-center rounded-xl bg-white/[0.08] transition-colors hover:bg-white/[0.12]"
                  aria-label={t("settings")}
                >
                  <IconAdjustments className="size-4" stroke={1.8} />
                </button>
                {panel === "settings" ? (
                  <ModelSettingsPanel
                    model={model}
                    settings={settings}
                    onChange={(next) => onSettingsChange?.(next)}
                    hideQuickFields
                    lockedFields={lockedFields}
                  />
                ) : null}
              </div>
            ) : null}

            <div className="ml-auto flex shrink-0 items-center gap-3 whitespace-nowrap">
              {cost != null ? (
                <span className="flex h-10 items-center gap-1 px-1 text-xs text-muted-foreground tabular-nums">
                  <IconBolt className="size-3.5" stroke={1.8} />
                  {cost}
                </span>
              ) : null}
              <span
                className="inline-flex"
                tabIndex={actionDisabled && disabledReason ? 0 : undefined}
                aria-describedby={actionDisabled && disabledReason ? disabledReasonId : undefined}
                title={disabledReason ?? actionLabel}
              >
                <button
                  type="button"
                  aria-label={actionLabel}
                  aria-busy={busy}
                  disabled={actionDisabled}
                  onClick={busy && onCancel ? onCancel : onSubmit}
                  className="flex size-10 items-center justify-center rounded-full bg-[#E52227] text-white shadow-lg shadow-[#E52227]/25 transition-colors hover:bg-[#c91e22] disabled:opacity-40"
                >
                  {busy ? (
                    onCancel ? (
                      <IconX className="size-4" stroke={2} />
                    ) : (
                      <IconLoader2 className="size-4 animate-spin" stroke={2} />
                    )
                  ) : (
                    <IconArrowUp className="size-4" stroke={2} />
                  )}
                </button>
              </span>
              {actionDisabled && disabledReason ? (
                <span id={disabledReasonId} className="sr-only">
                  {disabledReason}
                </span>
              ) : null}
              {busy && !onCancel ? (
                <span className="sr-only" role="status" aria-live="polite">
                  {submittingLabel ?? submitLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    );
  };

  return (
    <>
      {!expanded ? renderComposer("compact") : null}
      <Dialog open={expanded} onOpenChange={setExpandedPresentation}>
        <DialogContent
          ref={expandedSurfaceRef}
          animateOpen={false}
          aria-describedby={undefined}
          overlayClassName="z-[190] duration-200"
          showCloseButton={false}
          className="z-[200] h-[calc(100dvh-2rem)] max-h-[720px] w-[calc(100vw-2rem)] max-w-[1120px] gap-0 overflow-hidden rounded-[28px] bg-[oklch(0.175_0_0/0.98)] p-0 shadow-[0_40px_160px_rgba(0,0,0,0.78)] will-change-[transform,opacity] sm:h-[calc(100dvh-6rem)] sm:w-[calc(100vw-6rem)] sm:max-w-[1120px]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => expandTriggerRef.current?.focus());
          }}
          onEscapeKeyDown={(event) => {
            if (panel === null) return;
            event.preventDefault();
            closePanelAndRestoreFocus(panel);
          }}
        >
          {renderComposer("expanded")}
        </DialogContent>
      </Dialog>
    </>
  );
}
