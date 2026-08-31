"use client";

import { useMemo } from "react";
import { ExperiencePlayer, type ExperiencePlayerCopy } from "@repo/experience-player-react";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { useTranslations } from "@/src/i18n/i18n";

export function ExperienceRuntimePlayer({
  runtime,
  locale,
  randomSeed,
  coverUrl,
}: {
  runtime: ExperienceRuntimeManifest;
  locale: string;
  randomSeed: string;
  coverUrl?: string;
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
      videoLabel: () => t("videoLabel"),
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
      randomSeed={randomSeed}
      copy={copy}
      coverUrl={coverUrl}
    />
  );
}
