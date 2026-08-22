"use client";

import { useTranslations } from "next-intl";
import type { StoryStoryboardSequence } from "@/lib/story-production-api";
import { StoryProductionConflictPanel } from "./story-production-conflict-panel";
import { StoryProductionGenerationControl } from "./story-production-generation-control";

/**
 * One plot node = one card on the flattened board. The card carries the
 * node's identity and its clips as a row of media slots, each with a single
 * generate action. Prompts and per-clip details deliberately stay off this
 * board — a dedicated detail surface will own them later.
 */
export interface StorySequenceChoiceOptions {
  prompt: string;
  choices: { id: string; label: string; target: string }[];
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

export function StoryStoryboardSequenceSection({
  sequence,
  index,
  workspaceId,
  projectId,
  chapterId,
}: {
  sequence: StoryStoryboardSequence;
  index: number;
  workspaceId: string;
  projectId: string;
  chapterId: string;
}) {
  const t = useTranslations("storyStudio.storyboardPage");
  const scope = { workspaceId, projectId, chapterId };
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
        <div className="mt-4 flex flex-wrap gap-4">
          {sequence.clips.map((clip) => (
            <div key={clip.id} className="w-[200px]">
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
              />
              <p className="mt-1.5 truncate text-[11px] tabular-nums text-white/62">
                {clip.title} · {t("seconds", { value: seconds(clip.durationMs) })}
              </p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
