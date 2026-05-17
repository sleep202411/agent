"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  IconChevronDown,
  IconLock,
  IconPaperclip,
  IconPlus,
  IconSparkles,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { AiModel } from "../_data/mock-model";

export type ComposeBarProps = {
  prompt: string;
  onPromptChange: (v: string) => void;
  model: AiModel;
  models: AiModel[];
  onModelChange: (m: AiModel) => void;
  sizeValue: string;
  sizeOptions: { value: string; label: string; ratio: string }[];
  onSizeChange: (v: string) => void;
  qualityValue: string;
  qualityOptions: { value: string; label: string }[];
  onQualityChange: (v: string) => void;
  outputs: number;
  onOutputsChange: (n: number) => void;
  canSubmit: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  disabled?: boolean;
  t: (key: string, fallback?: string) => string;
};

export function ComposeBar(props: ComposeBarProps) {
  const {
    prompt,
    onPromptChange,
    model,
    models,
    onModelChange,
    sizeValue,
    sizeOptions,
    onSizeChange,
    qualityValue,
    qualityOptions,
    onQualityChange,
    outputs,
    onOutputsChange,
    canSubmit,
    isSubmitting,
    onSubmit,
    disabled,
    t,
  } = props;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [openPopover, setOpenPopover] = useState<null | "model" | "size" | "quality" | "more">(
    null
  );

  // Auto-grow the textarea up to ~5 lines. Plain DOM measurement —
  // avoids pulling in a dependency for one input.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 140);
    el.style.height = `${next}px`;
  }, [prompt]);

  const activeSize = sizeOptions.find((o) => o.value === sizeValue);
  const ratioLabel = activeSize?.ratio ?? "auto";

  // Server gates per-model access; mirror that gate in the UI so
  // locked models can't be submitted. Backend will reject anyway,
  // but pre-empting is friendlier than letting the user wait for a
  // 403 round-trip.
  const modelLocked = model.access?.allowed === false;
  const modelLockedTier = model.access?.requiredTier ?? null;

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter submits; plain Enter inserts newline.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canSubmit) onSubmit();
    }
  };

  return (
    <div
      className="rounded-2xl bg-zinc-900/95 px-3 py-3 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur"
      onMouseLeave={() => setOpenPopover(null)}
    >
      {/* Row 1 — Prompt + Create */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={t("imageLab.compose.placeholder", "Describe the image you imagine")}
          rows={1}
          disabled={disabled}
          className="min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 text-foreground placeholder:text-zinc-500 focus:outline-none disabled:opacity-50"
        />

        <Button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit || modelLocked}
          loading={isSubmitting}
          size="default"
          className="h-10 shrink-0 rounded-full bg-primary px-5 text-primary-foreground hover:bg-primary/90"
          icon={
            modelLocked ? (
              <IconLock className="size-4" />
            ) : !isSubmitting ? (
              <IconSparkles className="size-4" />
            ) : undefined
          }
          title={
            modelLocked
              ? modelLockedTier
                ? t("imageLab.compose.lockedTier", "Available to {tier}+ members").replace(
                    "{tier}",
                    modelLockedTier
                  )
                : t("imageLab.compose.lockedMember", "Available to members only")
              : undefined
          }
        >
          <span>
            {modelLocked
              ? modelLockedTier
                ? t("imageLab.compose.unlock", "Unlock {tier}").replace("{tier}", modelLockedTier)
                : t("imageLab.compose.unlockMember", "Members only")
              : t("imageLab.compose.create", "Create")}
          </span>
        </Button>
      </div>

      {/* Row 2 — chips + actions */}
      <div className="mt-2 flex items-center gap-1.5 px-1">
        {/* Add image (references) — disabled for text-to-image v1 */}
        <button
          type="button"
          disabled
          aria-label={t("imageLab.compose.addImage", "Add image")}
          className="inline-flex size-8 items-center justify-center rounded-lg bg-zinc-800/70 text-zinc-500 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed"
        >
          <IconPlus className="size-4" />
        </button>

        {/* Model chip */}
        <ChipPopover
          open={openPopover === "model"}
          onOpenChange={(v) => setOpenPopover(v ? "model" : null)}
          label={model.name}
          disabled={disabled || models.length < 2}
        >
          {models.map((option) => {
            const active = option.id === model.id;
            const locked = option.access?.allowed === false;
            const tier = option.access?.requiredTier ?? null;
            return (
              <PopoverItem
                key={option.id}
                active={active}
                onClick={() => {
                  // Allow selection of locked models — selecting one
                  // surfaces the unlock CTA in the Create button so
                  // the user understands which tier they need. We
                  // never silently swallow the click.
                  onModelChange(option);
                  setOpenPopover(null);
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="block flex-1 truncate text-sm font-semibold">{option.name}</span>
                  {locked && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-300">
                      <IconLock className="size-3" />
                      {tier ?? "VIP"}
                    </span>
                  )}
                </div>
                {option.description && (
                  <span className="block truncate text-[11px] text-zinc-400">
                    {option.description}
                  </span>
                )}
              </PopoverItem>
            );
          })}
        </ChipPopover>

        {/* Aspect ratio chip */}
        <ChipPopover
          open={openPopover === "size"}
          onOpenChange={(v) => setOpenPopover(v ? "size" : null)}
          label={ratioLabel}
          disabled={disabled}
        >
          {sizeOptions.map((option) => {
            const active = option.value === sizeValue;
            return (
              <PopoverItem
                key={option.value}
                active={active}
                onClick={() => {
                  onSizeChange(option.value);
                  setOpenPopover(null);
                }}
              >
                <span className="block text-sm font-medium">{option.label}</span>
              </PopoverItem>
            );
          })}
        </ChipPopover>

        {/* Quality chip — gpt-image-2 supports low/medium/high. `auto`
            is hidden because it routes to a chronically-overloaded
            Azure preview pool that times out. */}
        {qualityOptions.length > 0 && (
          <ChipPopover
            open={openPopover === "quality"}
            onOpenChange={(v) => setOpenPopover(v ? "quality" : null)}
            label={qualityLabel(qualityValue, qualityOptions, t)}
            disabled={disabled}
          >
            {qualityOptions.map((option) => {
              const active = option.value === qualityValue;
              return (
                <PopoverItem
                  key={option.value}
                  active={active}
                  onClick={() => {
                    onQualityChange(option.value);
                    setOpenPopover(null);
                  }}
                >
                  <span className="block text-sm font-medium capitalize">{option.label}</span>
                </PopoverItem>
              );
            })}
          </ChipPopover>
        )}

        {/* Outputs chip — only show when n>1 supported (gpt-image-2: max 10) */}
        <ChipPopover
          open={openPopover === "more"}
          onOpenChange={(v) => setOpenPopover(v ? "more" : null)}
          label={`×${outputs}`}
          disabled={disabled}
        >
          {[1, 2, 4].map((value) => {
            const active = value === outputs;
            return (
              <PopoverItem
                key={value}
                active={active}
                onClick={() => {
                  onOutputsChange(value);
                  setOpenPopover(null);
                }}
              >
                <span className="block text-sm font-medium">
                  {t("imageLab.compose.outputs", "Outputs")} · ×{value}
                </span>
              </PopoverItem>
            );
          })}
        </ChipPopover>

        <span className="flex-1" />

        {/* Add references (alias of attach) — placeholder pill for parity */}
        <button
          type="button"
          disabled
          className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-zinc-500 ring-1 ring-inset ring-zinc-700 transition-colors hover:text-zinc-300 disabled:cursor-not-allowed sm:inline-flex"
        >
          <IconPaperclip className="size-3.5" />
          <span>{t("imageLab.compose.addReferences", "Add references")}</span>
        </button>
      </div>
    </div>
  );
}

function qualityLabel(
  value: string,
  options: { value: string; label: string }[],
  t: (key: string, fallback?: string) => string
): string {
  const match = options.find((o) => o.value === value);
  const text = match?.label ?? value;
  return `${t("imageLab.compose.qualityChip", "Quality")} · ${text}`;
}

function ChipPopover({
  open,
  onOpenChange,
  label,
  disabled,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && onOpenChange(!open)}
        disabled={disabled}
        className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span>{label}</span>
        <IconChevronDown className="size-3 text-zinc-500" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 min-w-[200px] overflow-hidden rounded-xl bg-zinc-900 p-1 shadow-2xl ring-1 ring-white/10">
          {children}
        </div>
      )}
    </div>
  );
}

function PopoverItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-zinc-800 ${
        active ? "bg-primary/15 text-primary" : "text-zinc-200"
      }`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {active && <span className="mt-1.5 size-1.5 rounded-full bg-primary" />}
    </button>
  );
}
