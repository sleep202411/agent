"use client";

import { useState } from "react";
import { IconMessageCircle, IconPhoto, IconVideo } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import type { StoryStoryboardSequence } from "@/lib/story-production-api";
import { Button } from "@/components/ui/button";
import { StoryProductionConflictPanel } from "./story-production-conflict-panel";
import { StoryClipDetailDialog } from "./story-clip-detail-dialog";
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
  sequenceId,
  scope,
  durationLabel,
  allowGeneration,
}: {
  clip: StoryStoryboardSequence["clips"][number];
  sequenceId: string;
  scope: { projectId: string; chapterId: string };
  durationLabel: string;
  allowGeneration: boolean;
}) {
  const t = useTranslations("storyStudio.assetsPage");
  const boardT = useTranslations("storyStudio.storyboardPage");
  const [detailOpen, setDetailOpen] = useState(false);
  const KindIcon = clip.kind === "video" ? IconVideo : IconPhoto;
  return (
    <div className="relative w-[min(78vw,240px)] shrink-0 snap-start sm:w-[220px]">
      <span
        role="img"
        aria-label={boardT(`clipKind.${clip.kind}`)}
        title={boardT(`clipKind.${clip.kind}`)}
        className="pointer-events-none absolute top-2 right-2 z-10 grid size-6 place-items-center rounded-md bg-black/50 text-white/75 backdrop-blur-sm"
      >
        <KindIcon className="size-3.5" stroke={1.8} />
      </span>
      <StoryProductionGenerationControl
        scope={scope}
        target={{
          kind: "storyboard_clip",
          id: clip.id,
          sequenceId,
          version: clip.version,
          status: clip.status,
          latestGeneration: clip.latestGeneration,
        }}
        label={clip.title}
        selectedMedia={clip.selectedMediaVersion}
        outputKind={clip.kind}
        allowGeneration={allowGeneration}
        secondaryAction={
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="rounded-md bg-black/45 px-2 py-1 text-[11px] font-medium text-white/72 backdrop-blur-sm transition hover:bg-black/60 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
          >
            {t("details")}
          </button>
        }
      />
      <p className="mt-1.5 truncate text-[11px] tabular-nums text-white/62">
        {clip.title} · {durationLabel}
      </p>
      <StoryClipDetailDialog
        clip={clip}
        sequenceId={sequenceId}
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
 * Placeholder section for a plot node that has never been planned into a
 * storyboard sequence. It keeps the node visible (and deep-linkable) on the
 * board so the graph and the board always list the same scenes.
 */
export function StoryStoryboardUnplannedSection({
  nodeId,
  title,
  index,
  onRequestPlanning,
}: {
  nodeId: string;
  title: string;
  index: number;
  onRequestPlanning?: () => void;
}) {
  const t = useTranslations("storyStudio.storyboardPage");
  return (
    <article
      id={`plot-${nodeId}`}
      className="scroll-mt-6 rounded-2xl bg-white/[0.045] p-4 text-white shadow-sm"
      aria-label={title}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
        {t("plotNode", { index: index + 1 })}
      </span>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-white/94">{title}</h2>
        <code className="text-xs text-white/62">@{nodeId}</code>
      </div>
      <p className="mt-4 text-sm text-white/64">{t("unplanned")}</p>
      <p className="mt-1 text-xs text-white/50">{t("unplannedHint")}</p>
      {onRequestPlanning ? (
        <Button type="button" variant="secondary" className="mt-4" onClick={onRequestPlanning}>
          <IconMessageCircle aria-hidden="true" className="size-4" />
          {t("continueWithAgent")}
        </Button>
      ) : null}
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
  index,
  projectId,
  chapterId,
  allowGeneration = true,
}: {
  sequence: StoryStoryboardSequence;
  index: number;
  projectId: string;
  chapterId: string;
  allowGeneration?: boolean;
}) {
  const t = useTranslations("storyStudio.storyboardPage");
  const scope = { projectId, chapterId };
  // Storage and timeline invariants stay in milliseconds; seconds are display-only.
  const seconds = (ms: number) => Number((ms / 1000).toFixed(1));

  return (
    <article
      id={`plot-${sequence.plotNodeId}`}
      className="scroll-mt-6 rounded-2xl bg-white/[0.045] p-4 text-white shadow-sm"
      aria-label={sequence.title?.trim() || sequence.plotNodeId}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
          {t("plotNode", { index: index + 1 })}
        </span>
        {sequence.status !== "current" ? (
          <span className="rounded-md bg-amber-300/12 px-2 py-0.5 text-[10px] font-semibold text-amber-100/85">
            {t(`status.${sequence.status}`)}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-white/94">
          {sequence.title?.trim() || sequence.plotNodeId}
        </h2>
        <code className="text-xs text-white/62">@{sequence.plotNodeId}</code>
        <span className="text-xs tabular-nums text-white/62">
          {t("clipCount", { count: sequence.clips.length })} ·{" "}
          {t("seconds", { value: seconds(sequence.durationMs) })}
        </span>
      </div>
      {sequence.description ? (
        <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-white/70">
          {sequence.description}
        </p>
      ) : null}

      <StoryProductionConflictPanel
        scope={scope}
        target={{ kind: "storyboard_sequence", item: sequence }}
      />

      {sequence.clips.length === 0 ? (
        <p className="mt-4 text-sm text-white/64">{t("noClips")}</p>
      ) : (
        <div className="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
          {sequence.clips.map((clip) => (
            <StoryClipTile
              key={clip.id}
              clip={clip}
              sequenceId={sequence.id}
              scope={scope}
              durationLabel={t("seconds", { value: seconds(clip.durationMs) })}
              allowGeneration={allowGeneration}
            />
          ))}
        </div>
      )}
    </article>
  );
}
