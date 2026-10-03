"use client";

import { PlaySessionReportView } from "../interactive-film/_components/play-session-report";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useStoryCommunityAccess } from "./story-community-access";
import {
  ExperiencePlayer,
  type ExperienceAccessCheckpoint,
  type ExperiencePlayerCopy,
} from "@repo/experience-player-react";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { useTranslations } from "@/src/i18n/i18n";
import { createHttpPlaySessionReporter } from "@/src/lib/play-session-reporter.http";
import { hasFeature } from "@/src/lib/region/features";

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
  const commerce = useStoryCommunityAccess(runtime, locale);
  const playSessionReporter = useMemo(() => createHttpPlaySessionReporter(), []);
  const checkpointKey = `story-access-resume:${runtime.gameId}:${runtime.buildId}`;
  const readCheckpoint = useMemo(() => createCheckpointReader(checkpointKey), [checkpointKey]);
  const checkpoint = useSyncExternalStore(subscribeCheckpoint, readCheckpoint, serverCheckpoint);
  useEffect(() => {
    if (checkpoint === undefined) return;
    try {
      sessionStorage.removeItem(checkpointKey);
    } catch {
      /* Browser storage can be disabled. */
    }
  }, [checkpoint, checkpointKey]);
  const saveCheckpoint = useCallback(
    (snapshot: ExperienceAccessCheckpoint) => {
      try {
        sessionStorage.setItem(checkpointKey, JSON.stringify(snapshot));
      } catch {
        /* Storage restrictions do not prevent in-page playback. */
      }
    },
    [checkpointKey]
  );
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
      retryReport: t("retryReport"),
      mediaError: (assetId) => t("mediaError", { assetId }),
      videoLabel: () => t("videoLabel"),
      emptySequence: t("emptySequence"),
      loadingMedia: t("loadingMedia"),
      noVisibleChoices: t("noVisibleChoices"),
      continue: t("continue"),
      regionLabel: t("regionLabel"),
      video: { unmute: t("video.unmute") },
      playback: {
        pause: t("playback.pause"),
        resume: t("playback.resume"),
        paused: t("playback.paused"),
        continuePlaying: t("playback.continuePlaying"),
        interrupted: t("playback.interrupted"),
      },
    }),
    [t]
  );

  if (checkpoint === undefined)
    return (
      <div className="grid h-full place-items-center text-sm text-white/60">{t("starting")}</div>
    );
  return (
    <>
      <ExperiencePlayer
        access={commerce.access}
        accessCheckpoint={checkpoint ?? undefined}
        onAccessCheckpoint={saveCheckpoint}
        runtime={runtime}
        locale={locale}
        randomSeed={randomSeed}
        copy={copy}
        coverUrl={coverUrl}
        adaptivePlayback={hasFeature("adaptiveStoryPlayback")}
        playSessionReporter={playSessionReporter}
        endingExtra={(sessionId) =>
          sessionId ? <PlaySessionReportView sessionId={sessionId} /> : null
        }
      />
      {commerce.dialog}
    </>
  );
}

// A recharge-return checkpoint is consumed once per player mount. Live playback
// stays in the engine; this store only bridges an external payment navigation.
const subscribeCheckpoint = () => () => {};
const serverCheckpoint = () => undefined;

function createCheckpointReader(checkpointKey: string) {
  let snapshot: ExperienceAccessCheckpoint | null | undefined;
  return () => {
    if (snapshot !== undefined) return snapshot;
    try {
      const returning = new URLSearchParams(window.location.search).has("recharge");
      const raw = returning ? sessionStorage.getItem(checkpointKey) : null;
      const saved = raw ? (JSON.parse(raw) as ExperienceAccessCheckpoint) : null;
      snapshot = saved?.state && Array.isArray(saved.events) ? saved : null;
    } catch {
      snapshot = null;
    }
    return snapshot;
  };
}
