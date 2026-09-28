"use client";

import { useMemo } from "react";
import {
  ExperiencePlayer,
  type ExperienceAccessCheckpoint,
  type ExperiencePlayerCopy,
  type ExperiencePlayerProps,
} from "@repo/experience-player-react";
import { initializeExperienceRuntime, type PlaySessionReporter } from "@repo/experience-engine";
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
   * instead of the entry. Rendered as a restored initial state plus the same
   * scene.entered event controller.start() dispatches.
   */
  startSceneId?: string | null;
  onStateChange?: ExperiencePlayerProps["onStateChange"];
  playSessionReporter?: PlaySessionReporter;
}) {
  const t = useTranslations("experiencePlayer");
  const { access, dialog } = useStoryPreviewAccess(locale);
  const accessCheckpoint = useMemo<ExperienceAccessCheckpoint | undefined>(() => {
    if (!startSceneId) return undefined;
    const parsed = ExperienceRuntimeManifestSchema.safeParse(runtime);
    if (!parsed.success) return undefined;
    if (!parsed.data.graph.nodes.some((node) => node.sceneId === startSceneId)) {
      return undefined;
    }
    const initial = initializeExperienceRuntime(parsed.data);
    return {
      state: { ...initial, currentSceneId: startSceneId },
      events: [{ type: "scene.entered", sourceId: startSceneId, payload: {} }],
    };
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
      video: {
        play: t("video.play"),
        pause: t("video.pause"),
        mute: t("video.mute"),
        unmute: t("video.unmute"),
        volume: t("video.volume"),
        enterFullscreen: t("video.enterFullscreen"),
        exitFullscreen: t("video.exitFullscreen"),
        seekForward: t("video.seekForward"),
        seekBackward: t("video.seekBackward"),
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
        accessCheckpoint={accessCheckpoint}
        onStateChange={onStateChange}
        playSessionReporter={playSessionReporter}
      />
      {dialog}
    </>
  );
}
