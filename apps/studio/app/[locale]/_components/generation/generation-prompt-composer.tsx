"use client";

import { useId, useRef, type ReactNode } from "react";
import {
  IconAdjustments,
  IconArrowUp,
  IconBolt,
  IconChevronDown,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import type { MentionItem } from "@/lib/prompt-mentions";
import { cn } from "@/lib/utils";
import {
  type FizzAiCatalog,
  type FizzAiModel,
  type ModelSettings,
} from "@/app/[locale]/canvas/_lib/generation-api";
import { useModeLabel } from "@/app/[locale]/canvas/_lib/use-labels";
import { useDismiss } from "@/lib/use-dismiss";
import { ComposerQuickSettings } from "@/app/[locale]/canvas/_components/composer-quick-settings";
import { ModeMenu } from "@/app/[locale]/canvas/_components/mode-menu";
import { ModelPicker } from "@/app/[locale]/canvas/_components/model-picker";
import {
  hasRenderableModelSettings,
  ModelSettings as ModelSettingsPanel,
} from "@/app/[locale]/canvas/_components/model-settings";
import { PromptTextarea } from "@/app/[locale]/canvas/_components/prompt-textarea";

export type GenerationPromptComposerPanel = "model" | "settings" | "mode" | null;

/**
 * The single node-level Prompt Composer used by every creative canvas.
 *
 * It owns presentation and model controls only. Callers retain their domain
 * semantics: the general Canvas submits an AiJob, while Story Studio submits a
 * immutable input-snapshot FilmTake or TrailerTake through its own adapter.
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
  modality: "image" | "video";
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
  const ml = useModeLabel();
  useDismiss(panel !== null, () => onPanelChange(null));
  const modeTriggerRef = useRef<HTMLButtonElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const disabledReasonId = useId();

  const modelControlVisible = modelPickerEnabled && Boolean(onSelectModel);
  const modeControlVisible = modePickerEnabled && modes.length > 1 && Boolean(onSelectMode);
  const settingsControlVisible = settingsEnabled && Boolean(onSettingsChange);
  const hasAdvancedSettings = settingsControlVisible && hasRenderableModelSettings(model, true);
  const busy = submitting;
  const actionDisabled = busy ? !onCancel : !canSubmit;
  const actionLabel = busy
    ? onCancel
      ? (cancelLabel ?? submitLabel)
      : (submittingLabel ?? submitLabel)
    : submitLabel;

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

  return (
    <section
      className={cn(
        "nodrag nopan nowheel nokey w-[680px] rounded-3xl bg-white/[0.05] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-3xl backdrop-saturate-200",
        className
      )}
      aria-label={ariaLabel}
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape" || panel === null) return;
        event.stopPropagation();
        closePanelAndRestoreFocus(panel);
      }}
    >
      {referenceContent}

      {showPrompt ? (
        <div>
          <PromptTextarea
            value={prompt}
            onCommit={onPromptCommit}
            mentions={mentions}
            placeholder={promptPlaceholder}
            aria-label={promptAriaLabel}
            rows={promptRows}
            autoFocus={promptAutoFocus}
            readOnly={promptReadOnly}
            className="block max-h-40 w-full resize-none overflow-y-auto overscroll-contain bg-transparent pb-2 text-sm leading-6 outline-none placeholder:text-muted-foreground"
          />
          {promptHint ? (
            <p className="mt-1 text-[10px] leading-4 text-white/32">{promptHint}</p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-1.5 text-xs leading-5 text-destructive" role="alert" aria-live="polite">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-10 items-center gap-2 pt-2">
        {fixedControls}

        {modeControlVisible ? (
          <div className="relative" data-popover-zone>
            <button
              ref={modeTriggerRef}
              type="button"
              onClick={() => onPanelChange(panel === "mode" ? null : "mode")}
              aria-haspopup="menu"
              aria-expanded={panel === "mode"}
              className="flex h-10 items-center gap-1 rounded-xl bg-white/[0.08] px-3 text-sm font-medium transition-colors hover:bg-white/[0.12]"
            >
              {ml(mode ?? "")}
              <IconChevronDown className="size-3.5 text-muted-foreground" stroke={1.8} />
            </button>
            {panel === "mode" ? (
              <ModeMenu
                modes={modes}
                value={mode}
                onSelect={(nextMode) => onSelectMode?.(nextMode)}
                onClose={() => closePanelAndRestoreFocus("mode")}
              />
            ) : null}
          </div>
        ) : null}

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
              <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
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

        {settingsControlVisible ? (
          <ComposerQuickSettings
            model={model}
            settings={settings}
            onChange={(next) => onSettingsChange?.(next)}
            onOpenChange={onQuickSettingsOpenChange}
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
              />
            ) : null}
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-3">
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
    </section>
  );
}
