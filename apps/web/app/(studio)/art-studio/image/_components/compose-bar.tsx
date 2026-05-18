"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconChevronDown, IconLock, IconPlus, IconSparkles } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type { AiModel } from "../_data/mock-model";

export interface AiOption {
  value: string;
  label: string;
  /** Membership tier the option requires. `null` = open to all. */
  tier?: string | null;
}

export type ComposeBarProps = {
  prompt: string;
  onPromptChange: (v: string) => void;
  model: AiModel;
  models: AiModel[];
  onModelChange: (m: AiModel) => void;
  aspectRatioValue: string;
  aspectRatioOptions: AiOption[];
  onAspectRatioChange: (v: string) => void;
  resolutionTierValue: string;
  resolutionTierOptions: AiOption[];
  onResolutionTierChange: (v: string) => void;
  qualityValue: string;
  qualityOptions: AiOption[];
  onQualityChange: (v: string) => void;
  outputs: number;
  outputOptions: number[];
  onOutputsChange: (n: number) => void;
  /** Current user's tier rank — used to lock high-tier options. */
  userTierRank: number;
  tierRank: (tier: string | null | undefined) => number;
  /**
   * Number of this user's image jobs currently queued or running on
   * the selected model. When > 0 we surface a badge on the model
   * chip and disable the submit button — only one in-flight job at
   * a time per user.
   */
  activeJobCount: number;
  /**
   * True when at least one active job has progressed past the queue
   * (worker has picked it up). Drives "生成中" vs "排队中" wording
   * so a user alone in the queue doesn't see a confusing "queued"
   * label for the entire 50 s provider run.
   */
  activeJobRunning: boolean;
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
    aspectRatioValue,
    aspectRatioOptions,
    onAspectRatioChange,
    resolutionTierValue,
    resolutionTierOptions,
    onResolutionTierChange,
    qualityValue,
    qualityOptions,
    onQualityChange,
    outputs,
    outputOptions,
    onOutputsChange,
    userTierRank,
    tierRank,
    activeJobCount,
    activeJobRunning,
    canSubmit,
    isSubmitting,
    onSubmit,
    disabled,
    t,
  } = props;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [openPopover, setOpenPopover] = useState<
    null | "model" | "ratio" | "resolution" | "quality" | "outputs"
  >(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 140);
    el.style.height = `${next}px`;
  }, [prompt]);

  const modelLocked = model.access?.allowed === false;
  const modelLockedTier = model.access?.requiredTier ?? null;
  const modelBusy = activeJobCount > 0;
  const busyLabel = activeJobRunning
    ? t("imageLab.compose.generating", "Generating")
    : t("imageLab.compose.queued", "In queue");

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canSubmit) onSubmit();
    }
  };

  const isOptionLocked = (opt: AiOption) => opt.tier != null && tierRank(opt.tier) > userTierRank;

  const activeResolution = resolutionTierOptions.find((o) => o.value === resolutionTierValue);

  return (
    <div
      className="rounded-2xl bg-zinc-900/80 px-3 py-3 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/5 backdrop-blur-xl backdrop-saturate-150"
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
          disabled={!canSubmit || modelLocked || modelBusy}
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
            modelBusy
              ? t("imageLab.compose.busy", "Previous task is still running.")
              : modelLocked
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
            {modelBusy
              ? busyLabel
              : modelLocked
                ? modelLockedTier
                  ? t("imageLab.compose.unlock", "Unlock {tier}").replace("{tier}", modelLockedTier)
                  : t("imageLab.compose.unlockMember", "Members only")
                : t("imageLab.compose.create", "Create")}
          </span>
        </Button>
      </div>

      {/* Row 2 — chips. `flex-nowrap` + `shrink-0` on each chip keeps
          one row on desktop (compose bar is `max-w-3xl`, fits all
          chips comfortably). We intentionally do NOT add `overflow-
          x-auto` here — CSS treats `overflow-x: auto` + `overflow-y:
          visible` as both-auto, which would clip the chip popovers
          that pop upward. Narrow viewports just let the row overflow
          the bar (rare; mobile path can be revisited separately). */}
      <div className="mt-2 flex flex-nowrap items-center gap-1.5 px-1">
        {/* Add image (references) — placeholder for v1 */}
        <button
          type="button"
          disabled
          aria-label={t("imageLab.compose.addImage", "Add image")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800/70 text-zinc-500 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed"
        >
          <IconPlus className="size-4" />
        </button>

        {/* Model chip — always clickable so users can read the model's
            name/description even when only one model is registered.
            When the user has an in-flight job on this model we render
            a "queued" pill inside the chip — same chip-affordance
            (still openable to read details / switch model) but the
            generate button is disabled. */}
        <ChipPopover
          open={openPopover === "model"}
          onOpenChange={(v) => setOpenPopover(v ? "model" : null)}
          label={model.name}
          disabled={disabled}
          trailing={modelBusy ? <QueueBadge count={activeJobCount} label={busyLabel} /> : undefined}
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
                  onModelChange(option);
                  setOpenPopover(null);
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="block flex-1 truncate text-sm font-semibold">{option.name}</span>
                  {locked && <TierBadge tier={tier ?? "VIP"} />}
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

        {/* Ratio chip — visual icon */}
        <ChipPopover
          open={openPopover === "ratio"}
          onOpenChange={(v) => setOpenPopover(v ? "ratio" : null)}
          label={aspectRatioValue}
          leadingIcon={<RatioIcon ratio={aspectRatioValue} className="size-3.5" />}
          disabled={disabled}
        >
          <div className="grid grid-cols-3 gap-1">
            {aspectRatioOptions.map((option) => {
              const active = option.value === aspectRatioValue;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onAspectRatioChange(option.value);
                    setOpenPopover(null);
                  }}
                  className={`flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-primary/15 text-primary ring-1 ring-primary/50"
                      : "text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  <RatioIcon ratio={option.value} className="size-5" />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </ChipPopover>

        {/* Resolution chip — with crown on premium tiers */}
        {resolutionTierOptions.length > 0 && (
          <ChipPopover
            open={openPopover === "resolution"}
            onOpenChange={(v) => setOpenPopover(v ? "resolution" : null)}
            label={activeResolution?.label ?? resolutionTierValue}
            disabled={disabled}
          >
            {resolutionTierOptions.map((option) => {
              const active = option.value === resolutionTierValue;
              const locked = isOptionLocked(option);
              return (
                <PopoverItem
                  key={option.value}
                  active={active}
                  onClick={() => {
                    onResolutionTierChange(option.value);
                    setOpenPopover(null);
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="block flex-1 truncate text-sm font-medium">
                      {option.label}
                    </span>
                    {locked && <TierBadge tier={option.tier ?? "VIP"} />}
                  </div>
                </PopoverItem>
              );
            })}
          </ChipPopover>
        )}

        {/* Quality chip — low/medium/high (auto hidden) */}
        {qualityOptions.length > 0 && (
          <ChipPopover
            open={openPopover === "quality"}
            onOpenChange={(v) => setOpenPopover(v ? "quality" : null)}
            label={`${t("imageLab.compose.qualityChip", "Quality")} · ${
              qualityOptions.find((o) => o.value === qualityValue)?.label ?? qualityValue
            }`}
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

        {/* Outputs — flat segmented buttons (like PoseAI) */}
        <div className="ml-1 inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full bg-zinc-800/60 px-0.5">
          {outputOptions.map((value) => {
            const active = value === outputs;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onOutputsChange(value)}
                disabled={disabled}
                className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-medium transition-colors ${
                  active ? "bg-zinc-700 text-foreground" : "text-zinc-400 hover:text-zinc-200"
                } disabled:cursor-not-allowed disabled:opacity-60`}
                aria-label={`${value} ${value === 1 ? "image" : "images"}`}
              >
                ×{value}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Visual ratio icon ────────────────────────────────────────
// Draws a small proportional rectangle so users can see the shape
// without parsing "1:1" / "9:16" strings. Falls back to a square
// for unknown ratios.
function RatioIcon({ ratio, className }: { ratio: string; className?: string }) {
  const [w, h] = parseRatio(ratio);
  // Normalize so the longer side is 100% and the shorter is < 100%.
  const longest = Math.max(w, h);
  const widthPct = (w / longest) * 100;
  const heightPct = (h / longest) * 100;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className ?? ""}`}
      aria-hidden
    >
      <span
        className="rounded-sm border border-current"
        style={{ width: `${widthPct}%`, height: `${heightPct}%` }}
      />
    </span>
  );
}

function parseRatio(ratio: string): [number, number] {
  const match = ratio.match(/^(\d+):(\d+)$/);
  if (!match) return [1, 1];
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    return [1, 1];
  }
  return [a, b];
}

// ─── Tier badge (lock + tier name) ────────────────────────────
function TierBadge({ tier }: { tier: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-300">
      <IconLock className="size-3" />
      {tier}
    </span>
  );
}

// ─── Queue badge (amber pulsing dot + count) ─────────────────
// Tight single-line affordance: a pulsing dot + count, no text. The
// submit button right next to the chip already says "生成中" /
// "排队中"; repeating it inside the chip is visual noise.
function QueueBadge({ count, label }: { count: number; label: string }) {
  return (
    <span
      className="ml-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-300"
      title={`${label} · ${count}`}
    >
      <span className="inline-block size-1.5 animate-pulse rounded-full bg-amber-400" />
      {count}
    </span>
  );
}

function ChipPopover({
  open,
  onOpenChange,
  label,
  leadingIcon,
  trailing,
  disabled,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  label: string;
  leadingIcon?: React.ReactNode;
  trailing?: React.ReactNode;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && onOpenChange(!open)}
        disabled={disabled}
        className="inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {leadingIcon && <span className="text-zinc-400">{leadingIcon}</span>}
        <span className="truncate">{label}</span>
        {trailing}
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
