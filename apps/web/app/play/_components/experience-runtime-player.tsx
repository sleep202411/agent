"use client";

import { PlaySessionReportView } from "../interactive-film/_components/play-session-report";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useStoryCommunityAccess } from "./story-community-access";
import {
  ExperiencePlayer,
  type ExperienceAccessCheckpoint,
  type ExperiencePlayerCopy,
} from "@repo/experience-player-react";
import { restoreExperienceRuntime } from "@repo/experience-engine";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { useTranslations } from "@/src/i18n/i18n";
import { createHttpPlaySessionReporter } from "@/src/lib/play-session-reporter.http";
import { hasFeature } from "@/src/lib/region/features";
import {
  clearChapterSave,
  fetchChapterSave,
  fetchLatestSave,
  putChapterSave,
  putChapterSaveBeacon,
  type SavePayload,
} from "@/src/lib/story-saves";

/** Writes are throttled — a mid-choice burst must not spam the API. */
const SAVE_THROTTLE_MS = 3_000;

/**
 * Server-backed play saves (存档). One "current run" slot per
 * (user, game, chapter). On mount the player resolves the save to restore:
 * the URL's chapter wins when present, otherwise the latest save's chapter
 * (redirecting there first). A save is only restored after passing the
 * engine's restore validation against the LIVE manifest — non-breaking
 * republishes continue seamlessly, breaking ones discard the slot. Progress
 * is written back on state changes (throttled), at paid-gate checkpoints
 * (immediately, with the parked events) and on page hide (keepalive).
 */
export function ExperienceRuntimePlayer({
  runtime,
  locale,
  randomSeed,
  coverUrl,
  chapterId = "",
}: {
  runtime: ExperienceRuntimeManifest;
  locale: string;
  randomSeed: string;
  coverUrl?: string;
  /** The chapter this URL loaded; "" for single-chapter works. */
  chapterId?: string;
}) {
  const t = useTranslations("experiencePlayer");
  const router = useRouter();
  const pathname = usePathname();
  const commerce = useStoryCommunityAccess(runtime, locale);
  const playSessionReporter = useMemo(() => createHttpPlaySessionReporter(), []);

  type Resolution =
    | { phase: "resolving" }
    | { phase: "redirecting" }
    | { phase: "ready"; checkpoint: ExperienceAccessCheckpoint | null };
  const [resolution, setResolution] = useState<Resolution>({ phase: "resolving" });

  // ── Save restore ──────────────────────────────────────────────────────────
  const { gameId, buildId, contentVersion } = runtime;
  const rechargeKey = `story-access-resume:${gameId}:${buildId}`;
  // A restart in flight on THIS mount: effect re-runs (StrictMode, route
  // param strip) must wait for the slot deletion before reading saves, or
  // they would resurrect the run the user asked to discard.
  const restartClear = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const search = new URLSearchParams(window.location.search);

    // A recharge-return checkpoint (paid gate re-entry) beats the server
    // save: it carries the exact events parked at the gate.
    if (search.has("recharge")) {
      const raw = safeSessionGet(rechargeKey);
      const saved = raw ? (JSON.parse(raw) as ExperienceAccessCheckpoint) : null;
      const checkpoint = saved?.state && Array.isArray(saved.events) ? saved : null;
      setResolution({ phase: "ready", checkpoint });
      if (checkpoint) safeSessionRemove(rechargeKey);
      return;
    }

    // Explicit restart: drop the chapter's save, start a fresh run. Strip the
    // param so a refresh doesn't wipe the new run's first save again.
    if (search.has("restart")) {
      if (!restartClear.current) {
        restartClear.current = (async () => {
          await clearChapterSave(gameId, chapterId).catch(() => {
            /* Offline clear just means the next save overwrites the slot. */
          });
          // Reap late arrivals: the PREVIOUS page's pagehide beacon can land
          // after the deletion (keepalive outlives navigation) and resurrect
          // the run the user asked to discard. A delayed second clear wins
          // that race — no fresh-run write can exist yet (first PUT is ≥3s
          // of throttle after Start), so this can only delete stale data.
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
          await clearChapterSave(gameId, chapterId).catch(() => {});
        })();
        search.delete("restart");
        const nextSearch = search.toString();
        window.history.replaceState(null, "", nextSearch ? `${pathname}?${nextSearch}` : pathname);
      }
      void restartClear.current.finally(() => {
        if (!cancelled) setResolution({ phase: "ready", checkpoint: null });
      });
      return;
    }

    const resolve = async () => {
      try {
        // A restart already ran on this mount — wait out its deletion.
        if (restartClear.current) await restartClear.current;
        // The URL names a chapter → this page IS that chapter's runtime; use
        // its own slot. No chapter in the URL → follow the latest-played
        // pointer, redirecting when it names a different chapter.
        const save = search.has("chapter")
          ? await fetchChapterSave(gameId, chapterId)
          : await fetchLatestSave(gameId);
        if (cancelled) return;
        if (!save) {
          setResolution({ phase: "ready", checkpoint: null });
          return;
        }
        if (!search.has("chapter") && save.chapterId && save.chapterId !== chapterId) {
          search.set("chapter", save.chapterId);
          router.replace(`${pathname}?${search.toString()}`);
          setResolution({ phase: "redirecting" });
          return;
        }
        // Validation gate: the save must restore against the LIVE manifest.
        // A non-breaking republish passes; a breaking one discards the slot.
        try {
          restoreExperienceRuntime(runtime, save.state as never);
        } catch {
          await clearChapterSave(gameId, save.chapterId).catch(() => {});
          if (!cancelled) setResolution({ phase: "ready", checkpoint: null });
          return;
        }
        setResolution({
          phase: "ready",
          checkpoint: {
            state: save.state as ExperienceAccessCheckpoint["state"],
            events: (save.events ?? []) as ExperienceAccessCheckpoint["events"],
          },
        });
      } catch {
        // Save lookup is best-effort — playback never blocks on it.
        if (!cancelled) setResolution({ phase: "ready", checkpoint: null });
      }
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [gameId, chapterId, runtime, router, pathname, rechargeKey]);

  // ── Save writes ───────────────────────────────────────────────────────────
  const pendingSave = useRef<SavePayload | null>(null);
  const lastPutAt = useRef(0);
  const flushTimer = useRef<number | null>(null);
  const lastStatus = useRef<string | null>(null);
  const stateEmissions = useRef(0);
  const lastEmitted = useRef<string | null>(null);
  const slot = useRef({ gameId, chapterId, contentVersion });
  useEffect(() => {
    slot.current = { gameId, chapterId, contentVersion };
  }, [gameId, chapterId, contentVersion]);

  const flushSave = useCallback(async () => {
    const payload = pendingSave.current;
    if (!payload) return;
    pendingSave.current = null;
    lastPutAt.current = Date.now();
    try {
      await putChapterSave(slot.current.gameId, slot.current.chapterId, payload);
    } catch {
      /* Retained in pending semantics: the next change retries via throttle. */
      pendingSave.current = payload;
    }
  }, []);

  const scheduleSave = useCallback(
    (payload: SavePayload) => {
      pendingSave.current = payload;
      const elapsed = Date.now() - lastPutAt.current;
      if (elapsed >= SAVE_THROTTLE_MS) {
        if (flushTimer.current) {
          window.clearTimeout(flushTimer.current);
          flushTimer.current = null;
        }
        void flushSave();
        return;
      }
      if (!flushTimer.current) {
        flushTimer.current = window.setTimeout(() => {
          flushTimer.current = null;
          void flushSave();
        }, SAVE_THROTTLE_MS - elapsed);
      }
    },
    [flushSave]
  );

  useEffect(() => {
    const onHide = () => {
      const payload = pendingSave.current;
      if (!payload) return;
      pendingSave.current = null;
      putChapterSaveBeacon(slot.current.gameId, slot.current.chapterId, payload);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
    };
  }, []);

  const onStateChange = useCallback(
    (state: { status: string }) => {
      // The player re-emits the current state on every effect re-run
      // (StrictMode double-mount, prop identity churn), so persistence keys
      // off snapshots that actually differ from the last one seen: skipping
      // the mount emission (pre-Start) and repeats keeps a never-started
      // visit out of "continue playing". The run's FIRST save therefore
      // lands at its first real state change — first clip watched, first
      // choice, or a paid gate (the checkpoint path persists immediately) —
      // a Steam-style save-point inside the opening clip.
      const serialized = JSON.stringify(state);
      const isRepeat = serialized === lastEmitted.current;
      lastEmitted.current = serialized;
      stateEmissions.current += 1;
      if (stateEmissions.current === 1 || isRepeat) {
        lastStatus.current = state.status;
        return;
      }
      // Ending-screen "play again" starts a fresh run — drop the finished
      // slot so "continue" can never resurrect the completed run.
      if (lastStatus.current === "completed" && state.status !== "completed") {
        void clearChapterSave(slot.current.gameId, slot.current.chapterId).catch(() => {});
      }
      lastStatus.current = state.status;
      scheduleSave({
        contentVersion: slot.current.contentVersion,
        state,
        events: [],
      });
    },
    [scheduleSave]
  );

  const onAccessCheckpoint = useCallback(
    (checkpoint: ExperienceAccessCheckpoint) => {
      // The paid-gate state is the one worth resuming exactly — persist the
      // parked events alongside the state, immediately.
      scheduleSave({
        contentVersion: slot.current.contentVersion,
        state: checkpoint.state,
        events: checkpoint.events,
      });
      void flushSave();
      try {
        sessionStorage.setItem(rechargeKey, JSON.stringify(checkpoint));
      } catch {
        /* Storage restrictions do not prevent in-page playback. */
      }
    },
    [scheduleSave, flushSave, rechargeKey]
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

  if (resolution.phase !== "ready")
    return (
      <div className="grid h-full place-items-center text-sm text-white/60">{t("starting")}</div>
    );
  return (
    <>
      <ExperiencePlayer
        access={commerce.access}
        accessCheckpoint={resolution.checkpoint ?? undefined}
        onAccessCheckpoint={onAccessCheckpoint}
        onStateChange={onStateChange}
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

function safeSessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Browser storage can be disabled. */
  }
}
