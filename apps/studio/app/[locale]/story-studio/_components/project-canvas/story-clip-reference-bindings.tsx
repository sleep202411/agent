"use client";

import { useMemo, useState } from "react";
import { IconAlertTriangle, IconCheck, IconPhoto } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  FilmClipSummary,
  FilmReferenceSlot,
  FilmTrailerSummary,
} from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import {
  areStoryReferenceBindingKindsValid,
  isStoryReferenceBindingPlanValid,
  roleMatchesSlotKind,
  storyReferenceBindingEditorKey,
  type StoryReferenceBindingInput,
} from "./story-clip-reference-bindings-model";

type StoryClipReferenceBindingsProps = {
  subject?: "clip" | "trailer";
  clip: FilmClipSummary | FilmTrailerSummary;
  references: FilmReferenceSlot[];
  canEdit: boolean;
  apiConnected: boolean;
  pending: boolean;
  onSave: (bindings: StoryReferenceBindingInput[]) => void;
};

/**
 * Preserve local edits across ordinary refetches, but remount the stateful
 * editor when the server's actual bindings change. This prevents a stale
 * local copy from overwriting a newer clip or trailer binding plan.
 */
export function StoryClipReferenceBindings(props: StoryClipReferenceBindingsProps) {
  return (
    <StoryClipReferenceBindingsEditor
      key={storyReferenceBindingEditorKey(props.clip.id, props.clip.referenceBindings ?? [])}
      {...props}
    />
  );
}

function StoryClipReferenceBindingsEditor({
  subject = "clip",
  clip,
  references,
  canEdit,
  apiConnected,
  pending,
  onSave,
}: StoryClipReferenceBindingsProps) {
  const t = useTranslations("storyStudio.canvas.production.bindings");
  const approved = useMemo(
    () => references.filter((slot) => slot.status === "approved" && slot.approvedVersionId),
    [references]
  );
  const [bindings, setBindings] = useState<StoryReferenceBindingInput[]>(() =>
    (clip.referenceBindings ?? []).map(({ referenceSlotId, role, rank, required }) => ({
      referenceSlotId,
      role,
      rank,
      required,
    }))
  );
  const isOmni = clip.generationControl.mode === "omni_reference";
  const frameMode =
    clip.generationControl.mode === "frame_lock" ? clip.generationControl.frameMode : null;

  const setSingle = (role: "first_frame" | "last_frame", slotId: string) => {
    setBindings((current) => [
      ...current.filter((binding) => binding.role !== role),
      { referenceSlotId: slotId, role, rank: 0, required: true },
    ]);
  };
  const toggleOmni = (slotId: string) => {
    setBindings((current) => {
      const exists = current.some(
        (binding) => binding.role === "omni" && binding.referenceSlotId === slotId
      );
      const remaining = current.filter(
        (binding) => !(binding.role === "omni" && binding.referenceSlotId === slotId)
      );
      return exists
        ? remaining
        : [
            ...remaining,
            {
              referenceSlotId: slotId,
              role: "omni" as const,
              rank: remaining.filter((binding) => binding.role === "omni").length,
              required: true,
            },
          ];
    });
  };

  const firstFrame = bindings.find((binding) => binding.role === "first_frame");
  const lastFrame = bindings.find((binding) => binding.role === "last_frame");
  const eligibleOmni = approved.filter((slot) => roleMatchesSlotKind("omni", slot.kind));
  const eligibleFirst = approved.filter((slot) => roleMatchesSlotKind("first_frame", slot.kind));
  const eligibleLast = approved.filter((slot) => roleMatchesSlotKind("last_frame", slot.kind));
  const eligibleForMode = isOmni ? eligibleOmni : eligibleFirst;
  const valid =
    isStoryReferenceBindingPlanValid(clip.generationControl, bindings) &&
    areStoryReferenceBindingKindsValid(bindings, references);

  return (
    <section className="mt-5 rounded-[18px] bg-black/18 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold text-white/58">
            {t(subject === "trailer" ? "trailerTitle" : "title")}
          </p>
          <p className="mt-0.5 text-[9px] leading-4 text-white/28">
            {t(isOmni ? "omniDescription" : "frameDescription")}
          </p>
        </div>
        <span className="rounded-full bg-white/[0.055] px-2 py-1 text-[8px] font-semibold text-white/38">
          {t(isOmni ? "omni" : "frame")}
        </span>
      </div>

      {!apiConnected ? (
        <p className="mt-3 flex items-start gap-1.5 text-[9px] leading-4 text-white/34">
          <IconAlertTriangle className="mt-0.5 size-3 shrink-0" />
          {t("apiPending")}
        </p>
      ) : null}

      {isOmni ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {eligibleOmni.map((slot) => {
            const selected = bindings.some(
              (binding) => binding.role === "omni" && binding.referenceSlotId === slot.id
            );
            return (
              <button
                key={slot.id}
                type="button"
                disabled={!canEdit || !apiConnected}
                onClick={() => toggleOmni(slot.id)}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-xl bg-white/[0.04] p-2 text-left text-[9px] text-white/42 transition hover:bg-white/[0.08] disabled:opacity-50",
                  selected && "bg-white/[0.12] text-white/74"
                )}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-white/[0.055]">
                  {selected ? <IconCheck className="size-3" /> : <IconPhoto className="size-3" />}
                </span>
                <span className="truncate">{slot.label}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <BindingSelect
            label={t("firstFrame")}
            value={firstFrame?.referenceSlotId}
            slots={eligibleFirst}
            disabled={!canEdit || !apiConnected}
            onChange={(slotId) => setSingle("first_frame", slotId)}
          />
          {frameMode === "first_last_frame" ? (
            <BindingSelect
              label={t("lastFrame")}
              value={lastFrame?.referenceSlotId}
              slots={eligibleLast}
              disabled={!canEdit || !apiConnected}
              onChange={(slotId) => setSingle("last_frame", slotId)}
            />
          ) : null}
        </div>
      )}

      {eligibleForMode.length === 0 ? (
        <p className="mt-3 text-[9px] leading-4 text-white/30">{t("noApprovedSlots")}</p>
      ) : null}
      <Button
        size="sm"
        className="mt-3 w-full"
        disabled={!apiConnected || !canEdit || !valid || pending}
        onClick={() => onSave(bindings)}
      >
        <IconCheck className="size-3.5" />
        {t("save")}
      </Button>
    </section>
  );
}

function BindingSelect({
  label,
  value,
  slots,
  disabled,
  onChange,
}: {
  label: string;
  value?: string;
  slots: FilmReferenceSlot[];
  disabled: boolean;
  onChange: (slotId: string) => void;
}) {
  const t = useTranslations("storyStudio.canvas.production.bindings");
  return (
    <label>
      <span className="text-[9px] font-semibold text-white/38">{label}</span>
      <Select value={value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger className="mt-1.5 h-8! w-full rounded-xl bg-white/[0.055] text-[10px]">
          <SelectValue placeholder={t("selectSlot")} />
        </SelectTrigger>
        <SelectContent>
          {slots.map((slot) => (
            <SelectItem key={slot.id} value={slot.id}>
              {slot.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
