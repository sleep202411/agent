"use client";

import { useState } from "react";
import { IconPencil, IconPhoto, IconVideo, IconSubtitles } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import type { StoryStoryboardSequence } from "@/lib/story-production-api";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { StoryClipDetailDialog } from "./story-clip-detail-dialog";
import { StorySequenceSubtitlesDialog } from "./story-sequence-subtitles-dialog";
import { StoryClipVideoReplace } from "./story-clip-video-replace";
import { StoryProductionGenerationControl } from "./story-production-generation-control";

export interface StorySequenceChoiceOptions {
  prompt: string;
  choices: { id: string; label: string; target: string }[];
}

/**
 * One storyboard clip: its media slot with a single generate action, a kind
 * badge, and a details affordance for prompt/model editing.
 */
function StoryClipTile({
  clip,
  sequence,
  scope,
  durationLabel,
  allowGeneration,
  aspectRatio,
}: {
  clip: StoryStoryboardSequence["clips"][number];
  sequence: StoryStoryboardSequence;
  scope: { projectId: string; chapterId: string };
  durationLabel: string;
  allowGeneration: boolean;
  aspectRatio: string;
}) {
  const t = useTranslations("storyStudio.assetsPage");
  const boardT = useTranslations("storyStudio.storyboardPage");
  const [detailOpen, setDetailOpen] = useState(false);
  const KindIcon = clip.kind === "video" ? IconVideo : IconPhoto;
  return (
    <div className="relative w-[min(68vw,184px)] shrink-0 snap-start sm:w-[184px]">
      <span
        role="img"
        aria-label={boardT(`clipKind.${clip.kind}`)}
        title={boardT(`clipKind.${clip.kind}`)}
        className="pointer-events-none absolute top-2 left-2 z-10 grid size-6 place-items-center rounded-md bg-black/50 text-white/75 backdrop-blur-sm"
      >
        <KindIcon className="size-3.5" stroke={1.8} />
      </span>
      <StoryProductionGenerationControl
        scope={scope}
        target={{
          kind: "storyboard_clip",
          id: clip.id,
          sequenceId: sequence.id,
          version: clip.version,
          status: clip.status,
          latestGeneration: clip.latestGeneration,
        }}
        label={clip.title}
        selectedMedia={clip.selectedMediaVersion}
        outputKind={clip.kind}
        aspectRatio={aspectRatio}
        playback="inline"
        allowGeneration={allowGeneration && !clip.selectedMediaVersion}
        secondaryAction={
          <button
            type="button"
            onClick={() => {
              setDetailOpen(true);
            }}
            className="rounded-md bg-black/45 px-2 py-1 text-[11px] font-medium text-white/72 backdrop-blur-sm transition hover:bg-black/60 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
          >
            {t("details")}
          </button>
        }
      />
      <div className="mt-1.5 flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-white/62">
          {clip.title} · {durationLabel}
        </p>
      </div>
      <StoryClipVideoReplace
        projectId={scope.projectId}
        chapterId={scope.chapterId}
        sequence={sequence}
        clip={clip}
        enabled={allowGeneration}
        placement="corner"
        aspectRatio={aspectRatio}
      />
      <StoryClipDetailDialog
        clip={clip}
        sequenceId={sequence.id}
        projectId={scope.projectId}
        chapterId={scope.chapterId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        editable={allowGeneration}
      />
    </div>
  );
}

/**
 * A choice is a first-class card on the board, placed right after the plot
 * node whose footage ends on it — mirroring the Plot Tree's branch point in
 * the flat narrative order. Display-only; branch editing lives on the canvas.
 */
export function StoryStoryboardChoiceCard({ options }: { options: StorySequenceChoiceOptions }) {
  const t = useTranslations("storyStudio.storyboardPage");
  return (
    <article className="rounded-2xl bg-white/[0.045] p-4 text-white shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-blue)]">
          {t("options")}
        </span>
        {options.prompt ? (
          <span className="text-sm font-medium text-white/88">{options.prompt}</span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2.5">
        {options.choices.map((choice) => (
          <div
            key={choice.id}
            className="flex items-center gap-2 rounded-xl bg-black/24 px-3 py-2 text-sm"
          >
            <span className="font-medium text-white/92">{choice.label}</span>
            {choice.target ? (
              <>
                <span aria-hidden="true" className="text-white/45">
                  →
                </span>
                <span className="text-white/64">{choice.target}</span>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </article>
  );
}

/**
 * One plot node's planned sequence = one card on the flattened board: the
 * node's identity and its clips as a row of media slots, each with a single
 * generate action and a details dialog for its prompt and model.
 */
export function StoryStoryboardSequenceSection({
  sequence,
  title,
  description,
  index,
  clipKey,
  projectId,
  chapterId,
  allowGeneration = true,
  aspectRatio = "16 / 9",
}: {
  sequence: StoryStoryboardSequence;
  /** Canonical scene title from StoryDraft, never the sequence cache column. */
  title: string;
  /** The same node description edited in the Plot Tree, not a generated sequence summary. */
  description: string;
  index: number;
  /** Automatic clip key such as SCENE_1. Hidden when it is the only title. */
  clipKey: string;
  projectId: string;
  chapterId: string;
  allowGeneration?: boolean;
  /** Project overview frame ratio. Missing profiles stay 16:9. */
  aspectRatio?: string;
}) {
  const t = useTranslations("storyStudio.storyboardPage");
  const subtitlesT = useTranslations("storyStudio.subtitles");
  const [subtitlesOpen, setSubtitlesOpen] = useState(false);
  const scope = { projectId, chapterId };
  const readableTitle = title.trim() && title.trim() !== clipKey ? title.trim() : "";
  // Storage and timeline invariants stay in milliseconds; seconds are display-only.
  const seconds = (ms: number) => Number((ms / 1000).toFixed(1));

  return (
    <article
      id={`plot-${sequence.plotNodeId}`}
      className="scroll-mt-6 rounded-2xl bg-white/[0.045] p-4 text-white shadow-sm"
      aria-label={readableTitle || t("plotNode", { index: index + 1 })}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-base font-semibold text-white/94">
            {t("plotNode", { index: index + 1 })}
          </h2>
          {readableTitle ? (
            <span className="min-w-0 truncate text-sm text-white/80">{readableTitle}</span>
          ) : null}
          <span className="text-xs tabular-nums text-white/62">
            {t("clipCount", { count: sequence.clips.length })} ·{" "}
            {t("seconds", { value: seconds(sequence.durationMs) })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            aria-expanded={subtitlesOpen}
            onClick={() => setSubtitlesOpen(true)}
          >
            <IconSubtitles aria-hidden="true" />
            {subtitlesT("title")}
            {sequence.subtitleTracks.length > 0 ? ` (${sequence.subtitleTracks.length})` : ""}
          </Button>
          <Button asChild variant="primary-ghost" size="sm">
            <Link
              href={`/story-studio/projects/${projectId}/edit?chapter=${encodeURIComponent(chapterId)}&node=${encodeURIComponent(sequence.plotNodeId)}`}
            >
              <IconPencil aria-hidden="true" />
              {t("editTimeline")}
            </Link>
          </Button>
        </div>
      </header>
      {description.trim() ? (
        <div className="mt-3 max-w-3xl">
          <p className="text-xs font-medium text-muted-foreground">{t("nodeDescription")}</p>
          <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-sm leading-6 text-white/70">
            {description}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto pb-2">
        {sequence.clips.map((clip) => (
          <StoryClipTile
            key={clip.id}
            clip={clip}
            sequence={sequence}
            scope={scope}
            durationLabel={t("seconds", { value: seconds(clip.durationMs) })}
            allowGeneration={allowGeneration}
            aspectRatio={aspectRatio}
          />
        ))}
        <StoryClipVideoReplace
          projectId={projectId}
          chapterId={chapterId}
          sequence={sequence}
          enabled={allowGeneration}
          placement="placeholder"
          aspectRatio={aspectRatio}
        />
      </div>
      <StorySequenceSubtitlesDialog
        sequence={sequence}
        title={readableTitle || t("plotNode", { index: index + 1 })}
        projectId={projectId}
        chapterId={chapterId}
        open={subtitlesOpen}
        onOpenChange={setSubtitlesOpen}
        editable={allowGeneration}
      />
    </article>
  );
}
