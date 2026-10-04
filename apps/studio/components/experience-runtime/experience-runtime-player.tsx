"use client";

import { useMemo } from "react";
import {
  ExperiencePlayer,
  type ExperiencePlayerCopy,
  type ExperiencePlayerProps,
} from "@repo/experience-player-react";
import type { PlaySessionReporter } from "@repo/experience-engine";
import { ExperienceRuntimeManifestSchema } from "@repo/shared/experience-runtime";
import { useTranslations } from "next-intl";
import type { StoryFrameProfile } from "@/lib/story-projects-api";
import { WorldModelExperienceRenderer } from "./world-model-experience-renderer";
import { useStoryPreviewAccess } from "./use-story-preview-access";

export function ExperienceRuntimePlayer({
  runtime,
  locale,
  frameProfile,
  coverUrl,
  startSceneId,
  onStateChange,
  playSessionReporter,
}: {
  runtime: Record<string, unknown>;
  locale: string;
  frameProfile?: StoryFrameProfile;
  coverUrl?: string | null;
  /**
   * Authoring playtest hook: walk the compiled story from one chosen scene
   * instead of the entry — on every run, so Restart and Play again come back
   * to it too.
   */
  startSceneId?: string | null;
  onStateChange?: ExperiencePlayerProps["onStateChange"];
  playSessionReporter?: PlaySessionReporter;
}) {
  const t = useTranslations("experiencePlayer");
  const { access, dialog } = useStoryPreviewAccess(locale);
  // A scene the runtime no longer has — a link to one since deleted — plays
  // from the story's entry instead.
  const startScene = useMemo(() => {
    if (!startSceneId) return undefined;
    const parsed = ExperienceRuntimeManifestSchema.safeParse(runtime);
    if (!parsed.success) return undefined;
    return parsed.data.graph.nodes.some((node) => node.sceneId === startSceneId)
      ? startSceneId
      : undefined;
  }, [runtime, startSceneId]);
  const copy = useMemo<ExperiencePlayerCopy>(
    () => ({
      invalidManifest: t("invalidManifest"),
      manifestRoot: t("manifestRoot"),
      interactiveFilm: t("interactiveFilm"),
      starting: t("starting"),
      start: t("start"),
      endingEyebrow: t("completionEyebrow"),
      unknownEnding: () => t("completionTitle"),
      playAgain: t("playAgain"),
      runtimeError: t("runtimeError"),
      restart: t("restart"),
      mediaError: (assetId) => t("mediaError", { assetId }),
      videoLabel: (nodeId) => t("videoLabel", { nodeId }),
      emptySequence: t("emptySequence"),
      loadingMedia: t("loadingMedia"),
      noVisibleChoices: t("noVisibleChoices"),
      continue: t("continue"),
      regionLabel: t("regionLabel"),
      video: { unmute: t("video.unmute") },
      journeyMap: {
        open: t("journeyMap.open"),
        title: t("journeyMap.title"),
        description: t("journeyMap.description"),
        close: t("journeyMap.close"),
        current: t("journeyMap.current"),
        explored: t("journeyMap.explored"),
        unexplored: t("journeyMap.unexplored"),
        unexploredHint: t("journeyMap.unexploredHint"),
        replay: t("journeyMap.replay"),
        replaying: t("journeyMap.replaying"),
        replayHint: t("journeyMap.replayHint"),
        replayUnavailable: t("journeyMap.replayUnavailable"),
        empty: t("journeyMap.empty"),
        canvasLabel: t("journeyMap.canvasLabel"),
        centerCurrent: t("journeyMap.centerCurrent"),
        endingLabel: t("journeyMap.endingLabel"),
        truncated: t("journeyMap.truncated"),
        thumbnailUnavailable: t("journeyMap.thumbnailUnavailable"),
        sceneLabel: (number) => t("journeyMap.sceneLabel", { number }),
      },
      playback: {
        transport: {
          controlsLabel: t("playback.transport.controlsLabel"),
          rewind10: t("playback.transport.rewind10"),
          forward10: t("playback.transport.forward10"),
          progressLabel: t("playback.transport.progressLabel"),
          speedLabel: t("playback.transport.speedLabel"),
          watchedOnlyHint: t("playback.transport.watchedOnlyHint"),
          interactionBlocked: t("playback.transport.interactionBlocked"),
        },
        pause: t("playback.pause"),
        resume: t("playback.resume"),
        paused: t("playback.paused"),
        continuePlaying: t("playback.continuePlaying"),
        interrupted: t("playback.interrupted"),
      },
    }),
    [t]
  );

  return (
    <>
      <ExperiencePlayer
        access={access}
        runtime={runtime}
        locale={locale}
        coverUrl={coverUrl ?? undefined}
        frameProfile={
          frameProfile ? (frameProfile === "portrait_9_16" ? "portrait" : "landscape") : "auto"
        }
        copy={copy}
        renderWorldModel={(props) => <WorldModelExperienceRenderer {...props} />}
        startSceneId={startScene}
        onStateChange={onStateChange}
        playSessionReporter={playSessionReporter}
      />
      {dialog}
    </>
  );
}
