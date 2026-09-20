"use client";

import { useMemo } from "react";
import {
  ExperiencePlayer,
  type ExperiencePlayerCopy,
  type ExperiencePlayerProps,
} from "@repo/experience-player-react";
import { useTranslations } from "next-intl";
import type { StoryFrameProfile } from "@/lib/story-projects-api";
import { WorldModelExperienceRenderer } from "./world-model-experience-renderer";
import { useStoryPreviewAccess } from "./use-story-preview-access";

export function ExperienceRuntimePlayer({
  runtime,
  locale,
  frameProfile,
  coverUrl,
  onStateChange,
}: {
  runtime: Record<string, unknown>;
  locale: string;
  frameProfile?: StoryFrameProfile;
  coverUrl?: string | null;
  onStateChange?: ExperiencePlayerProps["onStateChange"];
}) {
  const t = useTranslations("experiencePlayer");
  const { access, dialog } = useStoryPreviewAccess(locale);
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
        onStateChange={onStateChange}
      />
      {dialog}
    </>
  );
}
