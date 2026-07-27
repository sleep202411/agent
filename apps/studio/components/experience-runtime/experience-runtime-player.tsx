"use client";

import { useMemo } from "react";
import { ExperiencePlayer, type ExperiencePlayerCopy } from "@repo/experience-player-react";
import { useTranslations } from "next-intl";
import type { StoryFrameProfile } from "@/lib/story-projects-api";

export function ExperienceRuntimePlayer({
  runtime,
  locale,
  frameProfile,
}: {
  runtime: Record<string, unknown>;
  locale: string;
  frameProfile?: StoryFrameProfile;
}) {
  const t = useTranslations("experiencePlayer");
  const copy = useMemo<ExperiencePlayerCopy>(
    () => ({
      invalidManifest: t("invalidManifest"),
      manifestRoot: t("manifestRoot"),
      interactiveFilm: t("interactiveFilm"),
      starting: t("starting"),
      start: t("start"),
      endingEyebrow: t("endingEyebrow"),
      unknownEnding: (endingId) => t("unknownEnding", { endingId }),
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
    <ExperiencePlayer
      runtime={runtime}
      locale={locale}
      frameProfile={
        frameProfile ? (frameProfile === "portrait_9_16" ? "portrait" : "landscape") : "auto"
      }
      copy={copy}
    />
  );
}
