"use client";

import { useState } from "react";
import { IconChevronDown, IconMovie, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import {
  StoryVideoGenerationForm,
  type StoryVideoGenerationFormProps,
} from "./story-video-generation-form";

type FoundationField = "logline" | "synopsis" | "worldview";

interface StoryWorldLibraryProps {
  content: InteractiveStoryDraftContent;
  canEdit: boolean;
  onUpdateFoundation: (field: FoundationField, value: string) => void;
  onClose: () => void;
  trailerGeneration?: StoryVideoGenerationFormProps;
}

export function StoryWorldLibrary({
  content,
  canEdit,
  onUpdateFoundation,
  onClose,
  trailerGeneration,
}: StoryWorldLibraryProps) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.12em] text-white/34 uppercase">
            {t("world.eyebrow")}
          </p>
          <h2 className="mt-1 text-base font-semibold">{t("world.title")}</h2>
          <p className="mt-1 text-[11px] leading-5 text-white/38">{t("world.description")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/48 transition hover:bg-white/[0.1] hover:text-white"
          aria-label={t("inspector.close")}
        >
          <IconX className="size-4" />
        </button>
      </header>

      <div className="mt-5">
        <FoundationEditor
          content={content}
          canEdit={canEdit}
          onUpdateFoundation={onUpdateFoundation}
        />
      </div>

      {trailerGeneration ? (
        <StoryWorldTrailerSection trailerGeneration={trailerGeneration} />
      ) : null}
    </>
  );
}

function StoryWorldTrailerSection({
  trailerGeneration,
}: {
  trailerGeneration: StoryVideoGenerationFormProps;
}) {
  const t = useTranslations("storyStudio.canvas");
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-5 rounded-[18px] bg-white/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/48">
          <IconMovie className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] font-semibold tracking-[0.12em] text-white/32 uppercase">
            {t("trailer.eyebrow")}
          </span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-white/76">
            {t("trailer.title")}
          </span>
        </span>
        <IconChevronDown
          className={cn("size-4 shrink-0 text-white/34 transition", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="mt-3">
          <p className="text-[10px] leading-4 text-white/36">{t("trailer.description")}</p>
          <div className="mt-3">
            <StoryVideoGenerationForm {...trailerGeneration} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FoundationEditor({
  content,
  canEdit,
  onUpdateFoundation,
}: Pick<StoryWorldLibraryProps, "content" | "canEdit" | "onUpdateFoundation">) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <div>
      <p className="text-[10px] leading-4 text-white/36">{t("foundation.description")}</p>
      <FoundationField
        label={t("foundation.logline")}
        placeholder={t("foundation.loglinePlaceholder")}
        value={content.storyBible.logline}
        rows={3}
        maxLength={1_000}
        disabled={!canEdit}
        onChange={(value) => onUpdateFoundation("logline", value)}
      />
      <FoundationField
        label={t("foundation.synopsis")}
        placeholder={t("foundation.synopsisPlaceholder")}
        value={content.storyBible.synopsis}
        rows={7}
        maxLength={20_000}
        disabled={!canEdit}
        onChange={(value) => onUpdateFoundation("synopsis", value)}
      />
      <FoundationField
        label={t("foundation.worldview")}
        placeholder={t("foundation.worldviewPlaceholder")}
        value={content.storyBible.worldview}
        rows={5}
        maxLength={20_000}
        disabled={!canEdit}
        onChange={(value) => onUpdateFoundation("worldview", value)}
      />
    </div>
  );
}

function FoundationField({
  label,
  placeholder,
  value,
  rows,
  maxLength,
  disabled,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  rows: number;
  maxLength: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-4 block">
      <span className="text-[10px] font-semibold text-white/42">{label}</span>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        className="mt-2 resize-none bg-white/[0.055] text-xs leading-5"
      />
    </label>
  );
}
