"use client";

import { IconChevronDown, IconChevronUp, IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  StoryClipPromptBeat,
  StoryClipPromptDraft,
  StoryClipReferenceRole,
  StoryTrailerPromptDraft,
} from "@/lib/story-projects-api";
import { compileDirectorPromptManifest } from "./story-director-prompt-compiler";
import {
  appendClipPromptBeat,
  moveClipPromptBeat,
  setClipPromptTargetDuration,
} from "./story-project-canvas-mutations";

const REFERENCE_ROLES: StoryClipReferenceRole[] = [
  "subject",
  "location",
  "prop",
  "style",
  "first_frame",
  "last_frame",
  "omni_reference",
  "other",
];

const BEAT_TEXT_FIELDS: Array<{
  key: Exclude<keyof StoryClipPromptBeat, "id" | "startMs" | "endMs">;
  rows: number;
  maxLength: number;
}> = [
  { key: "visual", rows: 3, maxLength: 4_000 },
  { key: "camera", rows: 2, maxLength: 2_000 },
  { key: "action", rows: 3, maxLength: 4_000 },
  { key: "performance", rows: 2, maxLength: 2_000 },
  { key: "emotion", rows: 2, maxLength: 2_000 },
  { key: "dialogue", rows: 2, maxLength: 2_000 },
  { key: "audio", rows: 2, maxLength: 2_000 },
  { key: "endState", rows: 2, maxLength: 2_000 },
  { key: "continuity", rows: 2, maxLength: 2_000 },
];

type StoryDirectorPromptDraft = StoryClipPromptDraft | StoryTrailerPromptDraft;

export function StoryDirectorPromptEditor<T extends StoryDirectorPromptDraft>({
  prompt,
  canEdit,
  onChange,
}: {
  prompt: T;
  canEdit: boolean;
  onChange: (next: T) => void;
}) {
  const t = useTranslations("storyStudio.canvas.director");
  const compiledPrompt = compileDirectorPromptManifest(prompt);
  const seedanceBudgetExceeded = compiledPrompt.length > 4_000;
  const lastBeat = prompt.beats.at(-1);
  const canSplitLastBeat = !lastBeat || lastBeat.endMs - lastBeat.startMs >= 2;

  const update = <K extends keyof T>(key: K, value: T[K]) => onChange({ ...prompt, [key]: value });

  const addBeat = () => {
    if (canSplitLastBeat) onChange(appendClipPromptBeat(prompt));
  };

  const updateTargetDuration = (targetDurationMs: number) => {
    onChange(setClipPromptTargetDuration(prompt, targetDurationMs));
  };

  return (
    <section className="mt-6 space-y-4 rounded-[20px] bg-white/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
      <div>
        <p className="text-[9px] font-semibold tracking-[0.12em] text-white/32 uppercase">
          {t("eyebrow")}
        </p>
        <h3 className="mt-1 text-sm font-semibold text-white/82">{t("title")}</h3>
        <p className="mt-1 text-[10px] leading-4 text-white/38">{t("description")}</p>
      </div>

      <PromptField label={t("fields.title")}>
        <Input
          value={prompt.title}
          disabled={!canEdit}
          maxLength={240}
          onChange={(event) => update("title", event.target.value)}
          className="mt-1.5 h-9 rounded-xl bg-white/[0.055] px-3"
        />
      </PromptField>

      <PromptField label={t("fields.description")}>
        <Textarea
          value={prompt.description}
          disabled={!canEdit}
          maxLength={4_000}
          rows={3}
          onChange={(event) => update("description", event.target.value)}
          className="mt-1.5 resize-none bg-white/[0.055] text-xs leading-5"
        />
      </PromptField>

      <div className="grid grid-cols-2 gap-2">
        <PromptField label={t("fields.duration")}>
          <Input
            type="number"
            min={0.1}
            max={600}
            step={0.1}
            value={prompt.targetDurationMs / 1_000}
            disabled={!canEdit}
            onChange={(event) => {
              const seconds = event.target.valueAsNumber;
              if (Number.isFinite(seconds) && seconds > 0 && seconds <= 600) {
                updateTargetDuration(Math.round(seconds * 1_000));
              }
            }}
            className="mt-1.5 h-9 rounded-xl bg-white/[0.055] px-3 tabular-nums"
          />
        </PromptField>
        <PromptField label={t("fields.generationMode")}>
          <Select
            value={prompt.generationControl.mode}
            disabled={!canEdit}
            onValueChange={(mode) =>
              update(
                "generationControl",
                mode === "omni_reference"
                  ? { mode: "omni_reference" }
                  : { mode: "frame_lock", frameMode: "first_frame" }
              )
            }
          >
            <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-white/[0.055] px-2.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="frame_lock">{t("generation.frameLock")}</SelectItem>
              <SelectItem value="omni_reference">{t("generation.omni")}</SelectItem>
            </SelectContent>
          </Select>
        </PromptField>
      </div>

      {prompt.generationControl.mode === "frame_lock" ? (
        <PromptField label={t("fields.frameMode")}>
          <Select
            value={prompt.generationControl.frameMode}
            disabled={!canEdit}
            onValueChange={(frameMode) =>
              update("generationControl", {
                mode: "frame_lock",
                frameMode: frameMode as "first_frame" | "first_last_frame",
              })
            }
          >
            <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-white/[0.055] px-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="first_frame">{t("generation.firstFrame")}</SelectItem>
              <SelectItem value="first_last_frame">{t("generation.firstLast")}</SelectItem>
            </SelectContent>
          </Select>
        </PromptField>
      ) : null}

      <PromptField label={t("fields.masterDirection")} hint={t("hints.masterDirection")}>
        <Textarea
          value={prompt.masterDirection}
          disabled={!canEdit}
          maxLength={20_000}
          rows={7}
          onChange={(event) => update("masterDirection", event.target.value)}
          className="mt-1.5 resize-y bg-white/[0.055] font-mono text-[10px] leading-5"
        />
      </PromptField>

      <PromptField label={t("fields.emotionalArc")}>
        <Textarea
          value={prompt.emotionalArc}
          disabled={!canEdit}
          maxLength={4_000}
          rows={3}
          onChange={(event) => update("emotionalArc", event.target.value)}
          className="mt-1.5 resize-none bg-white/[0.055] text-xs leading-5"
        />
      </PromptField>

      <div className="rounded-[16px] bg-black/16 p-3">
        <SectionHeader
          title={t("references.title")}
          description={t("references.description")}
          canAdd={canEdit && prompt.referenceRoleNotes.length < 100}
          addLabel={t("references.add")}
          onAdd={() =>
            update("referenceRoleNotes", [
              ...prompt.referenceRoleNotes,
              {
                id: nextStableId(
                  "reference",
                  prompt.referenceRoleNotes.map((reference) => reference.id)
                ),
                role: "subject",
                referenceId: "",
                note: "",
              },
            ])
          }
        />
        <div className="mt-3 space-y-2">
          {prompt.referenceRoleNotes.map((reference, index) => (
            <div key={reference.id} className="rounded-xl bg-white/[0.045] p-2.5">
              <div className="flex items-center gap-2">
                <Select
                  value={reference.role}
                  disabled={!canEdit}
                  onValueChange={(role) =>
                    update(
                      "referenceRoleNotes",
                      prompt.referenceRoleNotes.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? { ...candidate, role: role as StoryClipReferenceRole }
                          : candidate
                      )
                    )
                  }
                >
                  <SelectTrigger className="h-8! min-w-0 flex-1 rounded-lg bg-black/18 px-2.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    {REFERENCE_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {t(`references.roles.${role}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <RemoveButton
                  disabled={!canEdit}
                  label={t("references.remove")}
                  onClick={() =>
                    update(
                      "referenceRoleNotes",
                      prompt.referenceRoleNotes.filter(
                        (_candidate, candidateIndex) => candidateIndex !== index
                      )
                    )
                  }
                />
              </div>
              <Input
                value={reference.referenceId}
                disabled={!canEdit}
                maxLength={120}
                placeholder={t("references.referencePlaceholder")}
                onChange={(event) =>
                  update(
                    "referenceRoleNotes",
                    prompt.referenceRoleNotes.map((candidate, candidateIndex) =>
                      candidateIndex === index
                        ? { ...candidate, referenceId: event.target.value }
                        : candidate
                    )
                  )
                }
                className="mt-2 h-8 rounded-lg bg-black/18 px-2.5 font-mono text-[10px]"
              />
              <Textarea
                value={reference.note}
                disabled={!canEdit}
                maxLength={2_000}
                rows={2}
                placeholder={t("references.notePlaceholder")}
                onChange={(event) =>
                  update(
                    "referenceRoleNotes",
                    prompt.referenceRoleNotes.map((candidate, candidateIndex) =>
                      candidateIndex === index
                        ? { ...candidate, note: event.target.value }
                        : candidate
                    )
                  )
                }
                className="mt-2 resize-none bg-black/18 text-[10px] leading-4"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[16px] bg-black/16 p-3">
        <SectionHeader
          title={t("beats.title")}
          description={t("beats.description")}
          canAdd={canEdit && prompt.beats.length < 200 && canSplitLastBeat}
          addLabel={t("beats.add")}
          onAdd={addBeat}
        />
        {prompt.beats.length === 0 ? (
          <p className="mt-3 rounded-xl bg-white/[0.035] px-3 py-4 text-center text-[9px] text-[#e0a45c]/82">
            {t("beats.required")}
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {prompt.beats.map((beat, index) => (
              <BeatCard
                key={beat.id}
                beat={beat}
                index={index}
                total={prompt.beats.length}
                canEdit={canEdit}
                onChange={(next) =>
                  update(
                    "beats",
                    prompt.beats.map((candidate, candidateIndex) =>
                      candidateIndex === index ? next : candidate
                    )
                  )
                }
                onMove={(direction) => {
                  onChange(moveClipPromptBeat(prompt, index, direction));
                }}
                onRemove={() =>
                  update(
                    "beats",
                    prompt.beats.filter((_candidate, candidateIndex) => candidateIndex !== index)
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      <StringListEditor
        title={t("negative.title")}
        description={t("negative.description")}
        addLabel={t("negative.add")}
        itemLabel={t("negative.item")}
        values={prompt.negativeConstraints}
        canEdit={canEdit}
        maxItems={100}
        maxLength={1_000}
        onChange={(values) => update("negativeConstraints", values)}
      />

      <StringListEditor
        title={t("continuity.title")}
        description={t("continuity.description")}
        addLabel={t("continuity.add")}
        itemLabel={t("continuity.item")}
        values={prompt.continuityNotes}
        canEdit={canEdit}
        maxItems={100}
        maxLength={2_000}
        onChange={(values) => update("continuityNotes", values)}
      />

      <details className="group rounded-[16px] bg-black/20 p-3" open>
        <summary className="flex list-none items-center justify-between gap-3 text-xs font-semibold text-white/72">
          <span>{t("preview.title")}</span>
          <span className="text-[9px] font-normal tabular-nums text-white/30">
            {t("preview.count", { count: compiledPrompt.length })}
          </span>
        </summary>
        <p className="mt-1 text-[9px] leading-4 text-white/32">{t("preview.description")}</p>
        <p
          className={
            seedanceBudgetExceeded
              ? "mt-2 text-[9px] leading-4 text-[#e0a45c]/82"
              : "mt-2 text-[9px] leading-4 text-white/34"
          }
        >
          {t(seedanceBudgetExceeded ? "preview.requiresCompaction" : "preview.withinBudget")}
        </p>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-black/28 p-3 font-mono text-[9px] leading-4 text-white/58">
          {compiledPrompt}
        </pre>
      </details>
    </section>
  );
}

function BeatCard({
  beat,
  index,
  total,
  canEdit,
  onChange,
  onMove,
  onRemove,
}: {
  beat: StoryClipPromptBeat;
  index: number;
  total: number;
  canEdit: boolean;
  onChange: (next: StoryClipPromptBeat) => void;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.director");
  return (
    <article className="rounded-[14px] bg-white/[0.045] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold text-white/68">
            {t("beats.beat", { number: index + 1 })}
          </p>
          <p className="mt-0.5 font-mono text-[8px] text-white/28">{beat.id}</p>
        </div>
        <div className="flex items-center gap-1">
          <MiniButton
            disabled={!canEdit || index === 0}
            label={t("beats.moveUp")}
            onClick={() => onMove("up")}
          >
            <IconChevronUp />
          </MiniButton>
          <MiniButton
            disabled={!canEdit || index === total - 1}
            label={t("beats.moveDown")}
            onClick={() => onMove("down")}
          >
            <IconChevronDown />
          </MiniButton>
          <RemoveButton disabled={!canEdit} label={t("beats.remove")} onClick={onRemove} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SecondsField
          label={t("beats.start")}
          value={beat.startMs}
          disabled={!canEdit}
          onChange={(startMs) => onChange({ ...beat, startMs })}
        />
        <SecondsField
          label={t("beats.end")}
          value={beat.endMs}
          disabled={!canEdit}
          onChange={(endMs) => onChange({ ...beat, endMs })}
        />
      </div>
      <div className="mt-3 space-y-3">
        {BEAT_TEXT_FIELDS.map((field) => (
          <PromptField key={field.key} label={t(`beats.fields.${field.key}`)}>
            <Textarea
              value={beat[field.key]}
              disabled={!canEdit}
              rows={field.rows}
              maxLength={field.maxLength}
              onChange={(event) => onChange({ ...beat, [field.key]: event.target.value })}
              className="mt-1 resize-none bg-black/18 text-[10px] leading-4"
            />
          </PromptField>
        ))}
      </div>
    </article>
  );
}

function StringListEditor({
  title,
  description,
  addLabel,
  itemLabel,
  values,
  canEdit,
  maxItems,
  maxLength,
  onChange,
}: {
  title: string;
  description: string;
  addLabel: string;
  itemLabel: string;
  values: string[];
  canEdit: boolean;
  maxItems: number;
  maxLength: number;
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="rounded-[16px] bg-black/16 p-3">
      <SectionHeader
        title={title}
        description={description}
        canAdd={canEdit && values.length < maxItems}
        addLabel={addLabel}
        onAdd={() => onChange([...values, ""])}
      />
      <div className="mt-3 space-y-2">
        {values.map((value, index) => (
          <div key={index} className="flex items-start gap-2">
            <Textarea
              value={value}
              disabled={!canEdit}
              rows={2}
              maxLength={maxLength}
              aria-label={`${itemLabel} ${index + 1}`}
              onChange={(event) =>
                onChange(
                  values.map((candidate, candidateIndex) =>
                    candidateIndex === index ? event.target.value : candidate
                  )
                )
              }
              className="min-w-0 flex-1 resize-none bg-white/[0.045] text-[10px] leading-4"
            />
            <RemoveButton
              disabled={!canEdit}
              label={`${itemLabel} ${index + 1}`}
              onClick={() => onChange(values.filter((_candidate, i) => i !== index))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  canAdd,
  addLabel,
  onAdd,
}: {
  title: string;
  description: string;
  canAdd: boolean;
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="text-[10px] font-semibold text-white/66">{title}</h4>
        <p className="mt-1 text-[9px] leading-4 text-white/32">{description}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!canAdd}
        onClick={onAdd}
        aria-label={addLabel}
        title={addLabel}
      >
        <IconPlus />
      </Button>
    </div>
  );
}

function PromptField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[9px] font-semibold text-white/40">{label}</span>
      {hint ? (
        <span className="mt-0.5 block text-[8px] leading-3 text-white/24">{hint}</span>
      ) : null}
      {children}
    </label>
  );
}

function SecondsField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (milliseconds: number) => void;
}) {
  return (
    <PromptField label={label}>
      <Input
        type="number"
        min={0}
        max={600}
        step={0.1}
        value={value / 1_000}
        disabled={disabled}
        onChange={(event) => {
          const seconds = event.target.valueAsNumber;
          if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 600) {
            onChange(Math.round(seconds * 1_000));
          }
        }}
        className="mt-1 h-8 rounded-lg bg-black/18 px-2.5 tabular-nums"
      />
    </PromptField>
  );
}

function MiniButton({
  disabled,
  label,
  onClick,
  children,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-lg bg-black/16 text-white/34 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

function RemoveButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.045] text-white/30 transition hover:bg-white/[0.08] hover:text-destructive disabled:opacity-35"
    >
      <IconTrash className="size-3.5" />
    </button>
  );
}

function nextStableId(prefix: string, existing: string[]): string {
  const used = new Set(existing);
  let ordinal = existing.length + 1;
  while (used.has(`${prefix}:${ordinal}`)) ordinal += 1;
  return `${prefix}:${ordinal}`;
}
