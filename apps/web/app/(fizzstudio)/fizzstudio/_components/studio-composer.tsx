"use client";

import { SubmissionRecoveryNotice, type SubmissionRecovery } from "./submission-recovery-notice";

import { createPortal } from "react-dom";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconChevronDown,
  IconLoader2,
  IconMusic,
  IconPhoto,
  IconPlus,
  IconSend,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { getModelLabel, ModelSettingsPanel } from "./model-settings-panel";
import { StudioModeRail } from "./studio-mode-rail";
import { type StudioModeConfig, type StudioModeKey } from "../../_lib/studio-modes";
import {
  type FizzAiModel,
  type FizzAiReferenceKind,
  type ModelSettings,
} from "../../_lib/generation-api";

/**
 * A reference image in flight or ready. Shared by the image studio; mirrors the
 * shape the studio surfaces own (upload happens in the parent via signed URL).
 */
export interface StudioReferenceImage {
  assetId?: string;
  id: string;
  name: string;
  progress: number;
  uploading: boolean;
  url?: string;
  error?: string;
}

/**
 * One uploaded (or in-flight) reference item inside a schema-driven upload
 * card. `label` is the prompt mention token without the `@` (e.g. "Image1");
 * empty for slots that are not promptable (start/end frame).
 */
export interface StudioReferenceItem {
  id: string;
  kind: FizzAiReferenceKind;
  label: string;
  name: string;
  progress: number;
  uploading: boolean;
  url?: string;
  assetId?: string;
  error?: string;
  durationSeconds?: number;
}

/**
 * A schema-driven upload card (one per reference field the selected model
 * declares — reference images / videos / audio, or a single start/end frame).
 * The parent owns upload + validation; the composer renders working tiles.
 */
export interface StudioReferenceCard {
  /** Schema field name — stable key (startFrame, referenceImages, …). */
  slot: string;
  kind: FizzAiReferenceKind;
  /** Resolved card title (parent owns the i18n namespace). */
  title: string;
  items: StudioReferenceItem[];
  max: number;
  /** File-picker accept attribute, from the schema's x-ui metadata. */
  accept: string;
  multiple: boolean;
  /** Non-null ⇒ the add tile is disabled, with this reason as tooltip/hint. */
  addDisabledReason: string | null;
  onFiles: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}

/** Schema-driven reference upload section (video studio). */
export interface StudioComposerReferenceCards {
  cards: StudioReferenceCard[];
  totalCount: number;
  /** Combined ceiling across every card (x-ui maxTotalFiles); null = uncapped. */
  totalMax: number | null;
  uploadError: string | null;
  /** Items citable from the prompt via `@Label` — spans every reference kind. */
  mentionable: StudioReferenceItem[];
}

interface ReferenceMentionOption {
  id: string;
  kind: FizzAiReferenceKind;
  label: string;
  name: string;
  url?: string;
}

interface PromptMentionRange {
  end: number;
  query: string;
  start: number;
}

/** Mode-rail control bundle — present only for modality surfaces that have modes (video). */
export interface StudioComposerModes {
  modes: StudioModeConfig[];
  active: StudioModeKey;
  mode: StudioModeConfig;
  /** Resolved label for the active mode chip (parent owns the modes i18n namespace). */
  label: string;
  onSelect: (key: StudioModeKey) => void;
}

/** Reference-image control bundle — present only for surfaces that support references (image). */
export interface StudioComposerReferences {
  images: StudioReferenceImage[];
  limit: number;
  uploadError: string | null;
  onFiles: (files: FileList | null) => void;
  onRemove: (id: string) => void;
}

export interface StudioComposerProps {
  /** Flow-positioned canvas editor; settings open in a viewport dialog. */
  embedded?: boolean;
  /** i18n namespace key map; defaults to the shared `fizzStudio.studioComposer` namespace. */
  models: FizzAiModel[];
  catalogLoading: boolean;
  catalogError: boolean;
  selectedModelId: string;
  settings: ModelSettings;
  prompt: string;
  submitting: boolean;
  submitError: string | null;
  submissionRecovery?: SubmissionRecovery;
  priceEstimate: { sellPoints: number } | null;
  canSubmit: boolean;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onSelectModel: (id: string) => void;
  onSettingsChange: (settings: ModelSettings) => void;
  onRetryCatalog: () => void;
  /** Reference images (image studio). Omit for surfaces without reference support. */
  references?: StudioComposerReferences;
  /** Schema-driven reference upload cards (video studio). */
  referenceCards?: StudioComposerReferenceCards;
  /** Mode rail (video studio). Omit for surfaces without modes. */
  modes?: StudioComposerModes;
}

type ComposerPanel = "settings" | "mode";

/**
 * Shared, fully-controlled bottom-docked composer for the FizzStudio image and
 * video surfaces. It owns no business state beyond the open-panel and the
 * @-mention menu UI state; prompt / settings / references / submit all live in
 * the parent. Per-modality differences are props: `references` enables the
 * image reference stack + @-mention, `referenceCards` enables the schema-driven
 * video upload cards + kind-aware @-mention, `modes` enables the mode chip.
 */
export function StudioComposer({
  embedded = false,
  models,
  catalogLoading,
  catalogError,
  selectedModelId,
  settings,
  prompt,
  submitting,
  submitError,
  submissionRecovery,
  priceEstimate,
  canSubmit,
  onPromptChange,
  onSubmit,
  onSelectModel,
  onSettingsChange,
  onRetryCatalog,
  references,
  referenceCards,
  modes,
}: StudioComposerProps) {
  const t = useTranslations("fizzStudio.studioComposer");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [panel, setPanel] = useState<ComposerPanel | null>(null);
  const [mentionRange, setMentionRange] = useState<PromptMentionRange | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  const supportsReferences = Boolean(references && references.limit > 0);
  const referenceImages = references?.images ?? [];
  const referenceLimit = references?.limit ?? 0;
  const hasReferenceCards = Boolean(referenceCards && referenceCards.cards.length > 0);
  const supportsMentions = supportsReferences || Boolean(referenceCards);

  const modelLabel = selectedModelId
    ? getModelLabel(models, selectedModelId)
    : catalogLoading
      ? t("loadingModels")
      : models.length > 0
        ? t("selectModel")
        : t("noModelSelected");
  const sizeToken = prettyChipToken(composerSizeToken(settings), t);
  const durationToken = composerDurationToken(settings, t);
  const resolutionToken = typeof settings.resolution === "string" ? settings.resolution : "";

  const mentionOptions = useMemo<ReferenceMentionOption[]>(() => {
    if (referenceCards) {
      return referenceCards.mentionable
        .filter((item) => item.url && !item.error && item.label)
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          label: item.label,
          name: item.name,
          url: item.url,
        }));
    }
    return referenceImages
      .filter((image) => image.url && !image.error)
      .map((image, index) => ({
        id: image.id,
        kind: "image" as const,
        label: t("referenceMention.label", { number: index + 1 }),
        name: image.name,
        url: image.url,
      }));
  }, [referenceCards, referenceImages, t]);
  const filteredMentionOptions = useMemo(() => {
    if (!mentionRange) return [];
    const query = normalizeMentionQuery(mentionRange.query);
    if (!query) return mentionOptions;
    return mentionOptions.filter((option) =>
      normalizeMentionQuery(`${option.label} ${option.name}`).includes(query)
    );
  }, [mentionOptions, mentionRange]);
  const mentionOpen = Boolean(mentionRange && supportsMentions);

  const syncMentionRange = useCallback(
    (value: string, caret: number | null | undefined) => {
      if (!supportsMentions || caret == null) {
        setMentionRange(null);
        return;
      }
      const range = findPromptMentionRange(value, caret);
      setMentionRange(range);
      setActiveMentionIndex(0);
    },
    [supportsMentions]
  );

  const insertReferenceMention = useCallback(
    (option: ReferenceMentionOption) => {
      if (!mentionRange) return;
      const before = prompt.slice(0, mentionRange.start);
      const after = prompt.slice(mentionRange.end);
      const leading = before && !/\s$/.test(before) ? " " : "";
      const trailing = after && /^\s/.test(after) ? "" : " ";
      const insert = `${leading}@${option.label}${trailing}`;
      const nextPrompt = `${before}${insert}${after}`;
      const nextCaret = before.length + insert.length;
      onPromptChange(nextPrompt);
      setMentionRange(null);
      window.requestAnimationFrame(() => {
        promptInputRef.current?.focus();
        promptInputRef.current?.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [mentionRange, onPromptChange, prompt]
  );

  useEffect(() => {
    if (!mentionRange) return;
    setActiveMentionIndex((index) =>
      filteredMentionOptions.length === 0 ? 0 : Math.min(index, filteredMentionOptions.length - 1)
    );
  }, [filteredMentionOptions.length, mentionRange]);

  // Esc closes whichever panel is open (mode rail or settings).
  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  const settingsOpen = panel === "settings";
  const modeOpen = panel === "mode";

  return (
    <>
      {panel && !embedded ? (
        <button
          type="button"
          aria-label={t("closePanel")}
          onClick={() => setPanel(null)}
          className="fixed inset-0 z-[39] cursor-default bg-black/55 duration-150 animate-in fade-in-0"
        />
      ) : null}
      <div
        className={
          embedded
            ? "relative z-40"
            : "fixed inset-x-4 bottom-4 z-40 mx-auto max-w-[960px] lg:left-[72px] lg:right-6"
        }
      >
        {modeOpen && modes ? (
          <PanelDialog label={t("modePanelTitle")}>
            <FloatingPanel title={t("modePanelTitle")} onClose={() => setPanel(null)}>
              <div className="p-3">
                <StudioModeRail
                  modes={modes.modes}
                  active={modes.active}
                  onSelect={(key) => {
                    modes.onSelect(key);
                    setPanel(null);
                  }}
                />
              </div>
            </FloatingPanel>
          </PanelDialog>
        ) : null}
        {settingsOpen ? (
          <PanelDialog
            label={t("settingsDialogLabel")}
            portal={embedded}
            onClose={() => setPanel(null)}
          >
            <ModelSettingsPanel
              models={models}
              isLoading={catalogLoading}
              error={catalogError}
              selectedModelId={selectedModelId}
              settings={settings}
              onSelectModel={onSelectModel}
              onSettingsChange={onSettingsChange}
              onClose={() => setPanel(null)}
              onRetry={onRetryCatalog}
            />
          </PanelDialog>
        ) : null}

        <div className="relative z-10 w-full overflow-visible rounded-[16px] border border-white/[0.08] bg-[#141416] text-white shadow-[0_24px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="min-w-0 p-4">
            {supportsReferences ? (
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                onChange={(event) => {
                  references?.onFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
            ) : null}

            <div
              className={cn(
                "relative min-h-[98px]",
                supportsReferences &&
                  (referenceLimit > 4 ? "pl-[238px] sm:pl-[260px]" : "pl-[184px] sm:pl-[202px]"),
                hasReferenceCards && "pl-[238px] sm:pl-[260px]"
              )}
            >
              {supportsReferences ? (
                <ReferenceStack
                  images={referenceImages}
                  limit={referenceLimit}
                  addLabel={t("addReferenceImage")}
                  removeLabel={t("removeReferenceImage")}
                  overflowLabel={(count) => t("referenceOverflow", { count })}
                  onAdd={() => fileInputRef.current?.click()}
                  onRemove={(id) => references?.onRemove(id)}
                />
              ) : null}
              {/* Video: same fanned stack, one add card → kind menu (image/video/audio). */}
              {hasReferenceCards && referenceCards ? (
                <VideoReferenceStack
                  bundle={referenceCards}
                  addLabel={t("references.add")}
                  removeLabel={t("references.remove")}
                  overflowLabel={(count) => t("referenceOverflow", { count })}
                  totalLabel={
                    referenceCards.totalMax != null
                      ? t("references.total", {
                          count: referenceCards.totalCount,
                          max: referenceCards.totalMax,
                        })
                      : null
                  }
                />
              ) : null}
              <label className="sr-only" htmlFor="studio-composer-prompt">
                {t("promptLabel")}
              </label>
              <textarea
                ref={promptInputRef}
                id="studio-composer-prompt"
                maxLength={800}
                value={prompt}
                onChange={(event) => {
                  onPromptChange(event.target.value);
                  syncMentionRange(event.target.value, event.target.selectionStart);
                }}
                onKeyDown={(event) => {
                  if (mentionOpen) {
                    if (event.key === "Escape") {
                      // One Esc closes ONLY the mention menu — never the panel
                      // (window listener) or any parent overlay.
                      event.preventDefault();
                      event.stopPropagation();
                      setMentionRange(null);
                      return;
                    }
                    if (event.key === "ArrowDown" && filteredMentionOptions.length > 0) {
                      event.preventDefault();
                      setActiveMentionIndex((index) => (index + 1) % filteredMentionOptions.length);
                      return;
                    }
                    if (event.key === "ArrowUp" && filteredMentionOptions.length > 0) {
                      event.preventDefault();
                      setActiveMentionIndex(
                        (index) =>
                          (index - 1 + filteredMentionOptions.length) %
                          filteredMentionOptions.length
                      );
                      return;
                    }
                    if (event.key === "Enter" && filteredMentionOptions[activeMentionIndex]) {
                      event.preventDefault();
                      insertReferenceMention(filteredMentionOptions[activeMentionIndex]);
                      return;
                    }
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) {
                    event.preventDefault();
                    onSubmit();
                  }
                }}
                onSelect={(event) =>
                  syncMentionRange(event.currentTarget.value, event.currentTarget.selectionStart)
                }
                onBlur={() => {
                  window.setTimeout(() => setMentionRange(null), 120);
                }}
                placeholder={t("promptPlaceholder")}
                className="h-[98px] w-full resize-none bg-transparent text-sm leading-7 text-white outline-none placeholder:text-white/40"
              />
              {mentionOpen ? (
                <ReferenceMentionMenu
                  options={filteredMentionOptions}
                  activeIndex={activeMentionIndex}
                  emptyLabel={t("referenceMention.empty")}
                  addLabel={t("referenceMention.add")}
                  canAdd={supportsReferences && referenceImages.length < referenceLimit}
                  offsetForStack={supportsReferences || hasReferenceCards}
                  onAdd={() => fileInputRef.current?.click()}
                  onSelect={insertReferenceMention}
                />
              ) : null}
            </div>

            {references?.uploadError ? (
              <p className="mt-1 text-xs font-medium text-[#ff8a8d]">{references.uploadError}</p>
            ) : null}
            {referenceCards?.uploadError ? (
              <p className="mt-1 text-xs font-medium text-[#ff8a8d]">
                {referenceCards.uploadError}
              </p>
            ) : null}
            <SubmissionRecoveryNotice recovery={submissionRecovery} />
            {submitError ? (
              <p className="mt-1 text-xs font-medium text-[#ff8a8d]">{submitError}</p>
            ) : null}

            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {modes ? (
                  <button
                    type="button"
                    aria-expanded={modeOpen}
                    onClick={() => setPanel(modeOpen ? null : "mode")}
                    className={cn(
                      "inline-flex h-10 max-w-[220px] items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                      modeOpen
                        ? "border-white/20 bg-white/[0.1] text-white"
                        : "border-white/[0.08] bg-white/[0.05] text-white hover:bg-white/[0.08]"
                    )}
                  >
                    <modes.mode.icon className="size-4 shrink-0" stroke={1.8} />
                    <span className="truncate">{modes.label}</span>
                    <IconChevronDown className="size-4 shrink-0 text-white/48" stroke={1.9} />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-expanded={settingsOpen}
                  onClick={() => setPanel(settingsOpen ? null : "settings")}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.05] px-4 text-sm font-semibold text-white transition-colors hover:bg-white/[0.08]"
                >
                  {catalogLoading && !selectedModelId ? (
                    <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
                  ) : (
                    <IconAdjustmentsHorizontal className="size-4" stroke={1.8} />
                  )}
                  {modelLabel}
                  {sizeToken ? ` / ${sizeToken}` : ""}
                  {durationToken ? ` / ${durationToken}` : ""}
                  {resolutionToken ? ` / ${resolutionToken}` : ""}
                  <IconChevronDown className="size-4 text-white/48" stroke={1.9} />
                </button>
              </div>
              <div className="flex items-center gap-3">
                {priceEstimate ? (
                  <span className="text-sm font-semibold tabular-nums text-white/70">
                    {t("priceEstimate", { points: priceEstimate.sellPoints })}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={onSubmit}
                  className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[16px] bg-[#E52227] px-9 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(229,34,39,0.28)] transition hover:bg-[#c91d22] hover:scale-[1.01] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                >
                  {submitting ? t("creating") : t("create")}
                  {submitting ? (
                    <IconLoader2 className="size-5 animate-spin" stroke={1.9} />
                  ) : (
                    <IconSend className="size-5" stroke={1.9} />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── panel dialog (a11y wrapper: role, focus trap, focus restore) ─────────── */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible wrapper for the floating composer panels: role=dialog +
 * aria-modal, moves focus in on open, traps Tab inside, and restores focus to
 * the opener on close.
 */
function PanelDialog({
  label,
  children,
  portal = false,
  onClose,
}: {
  label: string;
  children: ReactNode;
  portal?: boolean;
  onClose?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.getAttribute("aria-hidden") !== "true" && el.offsetParent !== null
      );

    (focusables()[0] ?? container).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);

  const dialog = (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className={
        portal
          ? "fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 outline-none"
          : "outline-none"
      }
      onClick={(event) => {
        if (portal && event.target === event.currentTarget) onClose?.();
      }}
      onKeyDown={(event) => {
        if (portal && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose?.();
        }
      }}
    >
      {portal ? (
        <div className="relative max-h-[85vh] w-full max-w-[640px] overflow-y-auto rounded-2xl bg-[#141416]">
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
  return portal ? createPortal(dialog, document.body) : dialog;
}

function FloatingPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("fizzStudio.studioComposer");
  return (
    <div className="absolute inset-x-0 bottom-full z-50 mb-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141416] shadow-[0_24px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] duration-150 animate-in fade-in-0 slide-in-from-bottom-3">
      <div className="flex h-12 items-center justify-between px-4">
        <span className="text-sm font-semibold text-white/90">{title}</span>
        <button
          type="button"
          aria-label={t("closePanel")}
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconX className="size-4" stroke={1.8} />
        </button>
      </div>
      {children}
    </div>
  );
}

/* ── schema-driven reference stack (video) — mirrors the image fanned stack ── */

const REFERENCE_KIND_ICON = {
  image: IconPhoto,
  video: IconVideo,
  audio: IconMusic,
} as const;

/**
 * Video reference zone: the SAME fanned-stack visual as the image studio's
 * reference stack, generalized to mixed kinds. One add card opens a small
 * kind menu (images n/9, videos n/3, audio n/3) instead of a bare file picker.
 */
function VideoReferenceStack({
  bundle,
  addLabel,
  removeLabel,
  totalLabel,
  overflowLabel,
}: {
  bundle: StudioComposerReferenceCards;
  addLabel: string;
  removeLabel: string;
  totalLabel: string | null;
  overflowLabel: (count: number) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const entries = bundle.cards.flatMap((card) => card.items.map((item) => ({ card, item })));
  const visibleEntries = entries.slice(0, 4);
  const overflowCount = Math.max(0, entries.length - visibleEntries.length);
  const canAddAny = bundle.cards.some((card) => card.addDisabledReason == null);
  const blockedReason = canAddAny
    ? null
    : (bundle.cards.find((card) => card.addDisabledReason)?.addDisabledReason ?? null);

  const inputs = bundle.cards.map((card) => (
    <input
      key={card.slot}
      ref={(element) => {
        inputRefs.current[card.slot] = element;
      }}
      type="file"
      accept={card.accept}
      multiple={card.multiple}
      className="sr-only"
      onChange={(event) => {
        card.onFiles(event.target.files);
        event.currentTarget.value = "";
      }}
    />
  ));

  const menu = menuOpen ? (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => setMenuOpen(false)}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div className="absolute bottom-[calc(100%+10px)] left-0 z-50 w-[248px] rounded-[14px] border border-white/[0.1] bg-[#202124]/95 p-1.5 text-white shadow-[0_18px_48px_rgba(0,0,0,0.48)] backdrop-blur-xl">
        {totalLabel ? (
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium tabular-nums text-white/45">
            {totalLabel}
          </div>
        ) : null}
        {bundle.cards.map((card) => {
          const disabled = card.addDisabledReason != null;
          const KindIcon = REFERENCE_KIND_ICON[card.kind] ?? IconPhoto;
          return (
            <button
              key={card.slot}
              type="button"
              disabled={disabled}
              title={card.addDisabledReason ?? card.title}
              onClick={() => {
                setMenuOpen(false);
                inputRefs.current[card.slot]?.click();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors",
                disabled ? "cursor-not-allowed opacity-40" : "hover:bg-white/[0.07]"
              )}
            >
              <KindIcon className="size-4 shrink-0 text-white/70" stroke={1.7} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-white">
                  {card.title}
                </span>
                {disabled && card.addDisabledReason ? (
                  <span className="block truncate text-[10px] text-white/40">
                    {card.addDisabledReason}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[11px] font-medium tabular-nums text-white/40">
                {card.items.length}/{card.max}
              </span>
            </button>
          );
        })}
      </div>
    </>
  ) : null;

  if (visibleEntries.length === 0) {
    return (
      <div className="absolute left-0 top-0 z-10 overflow-visible">
        {inputs}
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          disabled={!canAddAny}
          title={blockedReason ?? addLabel}
          aria-label={addLabel}
          aria-expanded={menuOpen}
          className={cn(
            "flex h-[72px] w-[54px] rotate-[-5deg] items-center justify-center rounded-[9px] border-2 border-white/[0.16] bg-[#30343d] text-white/62 shadow-[0_16px_42px_rgba(0,0,0,0.32)] transition-colors",
            canAddAny
              ? "hover:border-white/[0.26] hover:bg-[#3a3f49] hover:text-white"
              : "cursor-not-allowed opacity-50"
          )}
        >
          <IconPlus className="size-6" stroke={1.8} />
        </button>
        {menu}
      </div>
    );
  }

  return (
    <div
      className="group/stack absolute left-0 top-0 z-10 h-[92px] w-[248px] overflow-visible"
      onMouseEnter={() => setExpanded(true)}
      onMouseMove={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onPointerEnter={() => setExpanded(true)}
      onPointerMove={() => setExpanded(true)}
      onPointerLeave={() => setExpanded(false)}
    >
      {inputs}
      {visibleEntries.map(({ card, item }, index) => {
        const compactLeft = index * 24;
        const expandedLeft = index * 42;
        const compactTop = [8, 0, 8, 4][index] ?? 6;
        const expandedTop = [6, 2, 6, 3][index] ?? 6;
        const compactRotate = ["-8deg", "4deg", "-3deg", "6deg"][index] ?? "0deg";
        const expandedRotate = ["-6deg", "-2deg", "2deg", "6deg"][index] ?? "0deg";
        const isLastVisible = index === visibleEntries.length - 1;
        return (
          <div
            key={item.id}
            className="group/card absolute h-[72px] w-[54px] overflow-visible rounded-[9px] border-2 border-white/90 bg-[#202022] shadow-[0_16px_42px_rgba(0,0,0,0.35)] transition-[left,top,rotate,translate] duration-200 ease-out hover:z-30 hover:-translate-y-1 hover:rotate-0"
            style={{
              left: expanded ? expandedLeft : compactLeft,
              top: expanded ? expandedTop : compactTop,
              rotate: expanded ? expandedRotate : compactRotate,
              zIndex: 10 + index,
            }}
            title={item.error ?? item.name}
          >
            <VideoStackMedia item={item} />
            {overflowCount > 0 && isLastVisible ? (
              <span className="absolute inset-x-1 bottom-1 rounded-full bg-black/62 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
                {overflowLabel(overflowCount)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                card.onRemove(item.id);
              }}
              className={cn(
                "absolute -right-2.5 -top-2.5 z-50 flex size-6 items-center justify-center rounded-full bg-[#27292e] text-white shadow-[0_8px_22px_rgba(0,0,0,0.5)] ring-1 ring-white/25 transition-opacity duration-150 group-hover/card:opacity-100",
                expanded ? "opacity-100" : "opacity-0"
              )}
              aria-label={removeLabel}
            >
              <IconX className="size-3.5" stroke={2.2} />
            </button>
          </div>
        );
      })}
      {canAddAny ? (
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={addLabel}
          aria-expanded={menuOpen}
          className="absolute top-[6px] flex h-[72px] w-[54px] rotate-[5deg] items-center justify-center rounded-[9px] border-2 border-white/[0.12] bg-[#30343d] text-white/68 shadow-[0_16px_38px_rgba(0,0,0,0.28)] transition-colors hover:border-white/[0.22] hover:bg-[#3a3f49] hover:text-white"
          style={{
            left: (expanded ? visibleEntries.length * 42 : visibleEntries.length * 24) + 12,
            zIndex: 20 + visibleEntries.length,
          }}
        >
          <IconPlus className="size-6" stroke={1.8} />
        </button>
      ) : null}
      {menu}
    </div>
  );
}

function VideoStackMedia({ item }: { item: StudioReferenceItem }) {
  return (
    <div className="relative size-full overflow-hidden rounded-[7px]">
      {item.uploading ? (
        <ReferenceUploadProgress progress={item.progress} />
      ) : item.error ? (
        <span className="flex size-full items-center justify-center text-[#ff8a8d]">
          <IconAlertTriangle className="size-5" stroke={1.8} />
        </span>
      ) : item.kind === "image" && item.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt={item.name} className="size-full object-cover" />
      ) : item.kind === "video" && item.url ? (
        <>
          <video
            src={item.url}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover"
          />
          {typeof item.durationSeconds === "number" ? (
            <span className="absolute bottom-0.5 right-0.5 rounded-full bg-black/65 px-1 py-px text-[8px] font-bold tabular-nums text-white">
              {formatClipSeconds(item.durationSeconds)}
            </span>
          ) : null}
        </>
      ) : item.kind === "audio" ? (
        <span className="flex size-full flex-col items-center justify-center gap-1 px-1 text-white/65">
          <IconMusic className="size-4" stroke={1.8} />
          <span className="max-w-full truncate text-[8px] font-medium leading-3">{item.name}</span>
        </span>
      ) : (
        <span className="flex size-full items-center justify-center text-white/40">
          <IconPhoto className="size-4" stroke={1.8} />
        </span>
      )}
      {item.label && !item.uploading && !item.error ? (
        <span className="absolute bottom-0.5 left-0.5 max-w-[calc(100%-4px)] truncate rounded-full bg-black/65 px-1 py-px text-[8px] font-bold text-white/85">
          @{item.label}
        </span>
      ) : null}
    </div>
  );
}

function formatClipSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/* ── mention menu ─────────────────────────────────────────────────────────── */

function ReferenceMentionMenu({
  options,
  activeIndex,
  emptyLabel,
  addLabel,
  canAdd,
  offsetForStack,
  onAdd,
  onSelect,
}: {
  options: ReferenceMentionOption[];
  activeIndex: number;
  emptyLabel: string;
  addLabel: string;
  canAdd: boolean;
  /** True when the image reference stack pads the prompt's left edge. */
  offsetForStack: boolean;
  onAdd: () => void;
  onSelect: (option: ReferenceMentionOption) => void;
}) {
  return (
    <div
      className={cn(
        "absolute top-8 z-[70] w-[270px] overflow-hidden rounded-[14px] border border-white/[0.1] bg-[#202124]/95 p-1.5 text-white shadow-[0_18px_48px_rgba(0,0,0,0.48)] backdrop-blur-xl",
        offsetForStack ? "left-[184px] sm:left-[202px]" : "left-0"
      )}
    >
      {options.length > 0 ? (
        <div className="max-h-[214px] overflow-y-auto">
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(option);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors",
                index === activeIndex ? "bg-white/[0.1]" : "hover:bg-white/[0.07]"
              )}
            >
              <span className="relative flex size-10 shrink-0 overflow-hidden rounded-[8px] bg-white/[0.06] ring-1 ring-white/[0.12]">
                {option.kind === "image" && option.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={option.url} alt="" className="size-full object-cover" />
                ) : option.kind === "video" && option.url ? (
                  <video
                    src={option.url}
                    muted
                    playsInline
                    preload="metadata"
                    className="size-full object-cover"
                  />
                ) : option.kind === "audio" ? (
                  <IconMusic className="m-auto size-4 text-white/50" stroke={1.8} />
                ) : option.kind === "video" ? (
                  <IconVideo className="m-auto size-4 text-white/50" stroke={1.8} />
                ) : (
                  <IconPhoto className="m-auto size-4 text-white/50" stroke={1.8} />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">
                  @{option.label}
                </span>
                <span className="block truncate text-xs text-white/45">{option.name}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-3 py-2.5 text-xs font-medium text-white/48">{emptyLabel}</div>
      )}
      {canAdd ? (
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onAdd();
          }}
          className="mt-1 flex h-9 w-full items-center justify-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.04] text-xs font-semibold text-white/78 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconPlus className="size-4" stroke={1.8} />
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}

function ReferenceUploadProgress({ progress }: { progress: number }) {
  return (
    <span className="flex size-full flex-col items-center justify-center gap-1 text-white/70">
      <IconLoader2 className="size-5 animate-spin" stroke={1.9} />
      <span className="text-xs font-semibold tabular-nums">{Math.round(progress)}%</span>
    </span>
  );
}

function ReferenceStack({
  images,
  limit,
  addLabel,
  removeLabel,
  overflowLabel,
  onAdd,
  onRemove,
}: {
  images: StudioReferenceImage[];
  limit: number;
  addLabel: string;
  removeLabel: string;
  overflowLabel: (count: number) => string;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleImages = images.slice(0, 4);
  const overflowCount = Math.max(0, images.length - visibleImages.length);
  const canAdd = images.length < limit;

  if (visibleImages.length === 0) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="absolute left-0 top-0 flex h-[72px] w-[54px] rotate-[-5deg] items-center justify-center rounded-[9px] border-2 border-white/[0.16] bg-[#30343d] text-white/62 shadow-[0_16px_42px_rgba(0,0,0,0.32)] transition-colors hover:border-white/[0.26] hover:bg-[#3a3f49] hover:text-white"
        aria-label={addLabel}
      >
        <IconPlus className="size-6" stroke={1.8} />
      </button>
    );
  }

  return (
    <div
      className="group/stack absolute left-0 top-0 z-10 h-[92px] w-[248px] overflow-visible"
      onMouseEnter={() => setExpanded(true)}
      onMouseMove={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onPointerEnter={() => setExpanded(true)}
      onPointerMove={() => setExpanded(true)}
      onPointerLeave={() => setExpanded(false)}
    >
      {visibleImages.map((image, index) => {
        const compactLeft = index * 24;
        const expandedLeft = index * 42;
        const compactTop = [8, 0, 8, 4][index] ?? 6;
        const expandedTop = [6, 2, 6, 3][index] ?? 6;
        const compactRotate = ["-8deg", "4deg", "-3deg", "6deg"][index] ?? "0deg";
        const expandedRotate = ["-6deg", "-2deg", "2deg", "6deg"][index] ?? "0deg";
        const isLastVisible = index === visibleImages.length - 1;
        return (
          <div
            key={image.id}
            className="group/card absolute h-[72px] w-[54px] overflow-visible rounded-[9px] border-2 border-white/90 bg-[#202022] shadow-[0_16px_42px_rgba(0,0,0,0.35)] transition-[left,top,rotate,translate] duration-200 ease-out hover:z-30 hover:-translate-y-1 hover:rotate-0"
            style={{
              left: expanded ? expandedLeft : compactLeft,
              top: expanded ? expandedTop : compactTop,
              rotate: expanded ? expandedRotate : compactRotate,
              zIndex: 10 + index,
            }}
          >
            <ReferenceStackMedia image={image} />
            {overflowCount > 0 && isLastVisible ? (
              <span className="absolute inset-x-1 bottom-1 rounded-full bg-black/62 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
                {overflowLabel(overflowCount)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(image.id);
              }}
              className={cn(
                "absolute -right-2.5 -top-2.5 z-50 flex size-6 items-center justify-center rounded-full bg-[#27292e] text-white shadow-[0_8px_22px_rgba(0,0,0,0.5)] ring-1 ring-white/25 transition-opacity duration-150 group-hover/card:opacity-100",
                expanded ? "opacity-100" : "opacity-0"
              )}
              aria-label={removeLabel}
            >
              <IconX className="size-3.5" stroke={2.2} />
            </button>
          </div>
        );
      })}
      {canAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="absolute top-[6px] flex h-[72px] w-[54px] rotate-[5deg] items-center justify-center rounded-[9px] border-2 border-white/[0.12] bg-[#30343d] text-white/68 shadow-[0_16px_38px_rgba(0,0,0,0.28)] transition-colors hover:border-white/[0.22] hover:bg-[#3a3f49] hover:text-white"
          style={{
            left: (expanded ? visibleImages.length * 42 : visibleImages.length * 24) + 12,
            zIndex: 20 + visibleImages.length,
          }}
          aria-label={addLabel}
        >
          <IconPlus className="size-6" stroke={1.8} />
        </button>
      ) : null}
    </div>
  );
}

function ReferenceStackMedia({ image }: { image: StudioReferenceImage }) {
  return (
    <div className="size-full overflow-hidden rounded-[7px]">
      {image.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.url} alt="" className="size-full object-cover" />
      ) : image.uploading ? (
        <ReferenceUploadProgress progress={image.progress} />
      ) : (
        <span className="flex size-full items-center justify-center text-[#ff8a8d]">
          <IconPhoto className="size-4" stroke={1.8} />
        </span>
      )}
    </div>
  );
}

/* ── mention helpers (shared verbatim with the previous image composer) ───── */

function findPromptMentionRange(value: string, caret: number): PromptMentionRange | null {
  const beforeCaret = value.slice(0, caret);
  const start = beforeCaret.lastIndexOf("@");
  if (start < 0) return null;
  const query = beforeCaret.slice(start + 1);
  if (query.includes("\n") || query.length > 32) return null;
  const previous = start > 0 ? value[start - 1] : "";
  if (previous && !/\s|[　([{"'“‘，。；：！？、]/.test(previous)) return null;
  return {
    start,
    end: caret,
    query,
  };
}

function normalizeMentionQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** The aspect-ratio / size token shown in the model chip (image: imageSize, video: aspectRatio). */
function composerSizeToken(settings: ModelSettings): string {
  const imageSize = settings.imageSize;
  if (typeof imageSize === "string" && imageSize) return imageSize;
  const aspectRatio = settings.aspectRatio;
  if (typeof aspectRatio === "string" && aspectRatio) return aspectRatio;
  return "";
}

/** Duration chip token: enum string ('auto'/'5'…) or legacy numeric seconds. */
function composerDurationToken(
  settings: ModelSettings,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const duration = settings.duration;
  if (typeof duration === "string" && duration) {
    return duration === "auto" ? t("tokens.auto") : `${duration}s`;
  }
  const durationSeconds = settings.durationSeconds;
  if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds)) {
    return `${durationSeconds}s`;
  }
  return "";
}

/** Pretty-print raw enum tokens for the chip ('auto' → localized "Auto"). */
function prettyChipToken(
  token: string,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (token === "auto") return t("tokens.auto");
  return token;
}
