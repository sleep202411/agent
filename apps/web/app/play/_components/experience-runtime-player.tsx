"use client";

import { PlaySessionReportView } from "../interactive-film/_components/play-session-report";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useStoryCommunityAccess } from "./story-community-access";
import {
  ExperiencePlayer,
  validateExperiencePlaybackCheckpoint,
  validateExperienceJourney,
  type ExperienceCheckpointReason,
  type ExperienceAccessCheckpoint,
  type ExperiencePlayerCopy,
} from "@repo/experience-player-react";
import { restoreExperienceRuntime } from "@repo/experience-engine";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { useTranslations } from "@/src/i18n/i18n";
import { createHttpPlaySessionReporter } from "@/src/lib/play-session-reporter.http";
import { hasFeature } from "@/src/lib/region/features";
import { ApiRequestError } from "@/src/lib/api/api-client";
import {
  fetchLatestSave,
  getStorySaveChannel,
  getStorySaveSessionId,
  reloadStorySaveGame,
  readStorySaveSession,
  type SavePayload,
  type StorySave,
  type StorySaveStatus,
} from "@/src/lib/story-saves";

/** Writes are throttled — a mid-choice burst must not spam the API. */
const SAVE_THROTTLE_MS = 3_000;

type RuntimePlayerProps = {
  runtime: ExperienceRuntimeManifest;
  locale: string;
  randomSeed: string;
  coverUrl?: string;
  /** The chapter this URL loaded; "" for single-chapter works. */
  chapterId?: string;
  /** Chapter identities from the current published Game Manifest, already read by the page. */
  availableChapterIds: readonly string[];
};

export function ExperienceRuntimePlayer(props: RuntimePlayerProps) {
  const { runtime, chapterId = "" } = props;
  const { user, isLoading, isFetched } = useCurrentUser();
  const t = useTranslations("experiencePlayer");
  if (isLoading || !isFetched) {
    return (
      <div className="grid h-full place-items-center text-sm text-white/60">{t("starting")}</div>
    );
  }
  // Route transitions must not reuse resolved checkpoints or queued writes
  // from another chapter or published build.
  return (
    <ResolvedRuntimePlayer
      key={JSON.stringify([
        runtime.gameId,
        chapterId,
        runtime.buildId,
        runtime.contentVersion,
        props.availableChapterIds,
        user?.id ?? null,
        getStorySaveSessionId(user?.id ?? "anonymous"),
      ])}
      {...props}
      accountId={user?.id ?? null}
    />
  );
}

/**
 * Server-backed play saves (存档). One "current run" slot per
 * (user, game, chapter). On mount the player resolves the save to restore:
 * the URL's chapter wins when present, otherwise the latest save's chapter
 * (redirecting there first). A save is only restored after passing the
 * engine's restore validation against the LIVE manifest — non-breaking
 * republishes continue seamlessly. Incompatible saves require an explicit
 * restart before their slots are cleared. Progress
 * and media positions are saved from consistent player checkpoints. Progress
 * is merged for three seconds; transitions, pause, seek and access save
 * immediately. Conditional revisions protect other tabs and devices.
 */
function ResolvedRuntimePlayer({
  runtime: publishedRuntime,
  locale,
  randomSeed,
  coverUrl,
  chapterId = "",
  availableChapterIds: publishedChapterIds,
  accountId,
}: RuntimePlayerProps & { accountId: string | null }) {
  // These inputs belong to the immutable version key. A parent recreating
  // the same objects must not bootstrap again over a run already in progress.
  const [runtime] = useState(publishedRuntime);
  const [availableChapterIds] = useState(publishedChapterIds);
  const t = useTranslations("experiencePlayer");
  const commonT = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const commerce = useStoryCommunityAccess(runtime, locale);
  const playSessionReporter = useMemo(() => createHttpPlaySessionReporter(), []);

  type Resolution =
    | { phase: "resolving" }
    | { phase: "redirecting" }
    | { phase: "incompatible"; savedChapterId: string; reason: "chapter" | "state" }
    | { phase: "restart-failed" }
    | { phase: "read-failed"; error: string }
    | { phase: "conflict"; error: string }
    | { phase: "ready"; checkpoint: ExperienceAccessCheckpoint | null };
  const [resolution, setResolution] = useState<Resolution>({ phase: "resolving" });
  const [restartPending, setRestartPending] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const [sessionCookie] = useState(readStorySaveSession);
  // The writer belongs to this immutable account/chapter, but outlives this
  // view so a SPA transition can wait for its last checkpoint before reading.
  const [channel] = useState(() =>
    getStorySaveChannel(accountId ?? "anonymous", runtime.gameId, chapterId)
  );
  const [saveStatus, setSaveStatus] = useState<StorySaveStatus>(channel.getStatus());
  const [playerGeneration, setPlayerGeneration] = useState(0);
  const reloadRequested = useRef(false);
  const restartClear = useRef<Promise<void> | null>(null);
  const ready = useRef(false);
  useLayoutEffect(() => {
    ready.current = resolution.phase === "ready";
  }, [resolution.phase]);
  const mounted = useRef(false);
  const requests = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    requests.current = controller;
    return () => {
      mounted.current = false;
      controller.abort();
      restartClear.current = null;
      // A pending restart belongs to the account that requested it. Remove
      // its URL intent before a replacement account mounts on this page.
      if (sessionCookie !== readStorySaveSession()) stripRestartParam(pathname);
    };
  }, [sessionCookie, pathname]);
  const ownsSession = useCallback(
    () => mounted.current && sessionCookie === readStorySaveSession(),
    [sessionCookie]
  );

  useEffect(() => channel.subscribe(setSaveStatus), [channel]);

  // ── Save restore ──────────────────────────────────────────────────────────
  const { gameId, buildId, contentVersion } = runtime;
  const rechargeKey = `story-access-resume:${gameId}:${buildId}:${accountId ?? "anonymous"}`;
  // A restart in flight on THIS mount: effect re-runs (StrictMode, route
  // param strip) must wait for the slot deletion before reading saves, or
  // they would resurrect the run the user asked to discard.
  useEffect(() => {
    let cancelled = false;
    const search = new URLSearchParams(window.location.search);
    const signal = requests.current?.signal;
    const owns = () => !cancelled && ownsSession();

    // Anonymous playback stays local. Sign-in remounts into its account's
    // namespace and then reads that account's server-backed progress.
    if (!accountId) {
      if (search.has("restart")) stripRestartParam(pathname);
      queueMicrotask(() => {
        if (owns()) setResolution({ phase: "ready", checkpoint: null });
      });
      return () => {
        cancelled = true;
      };
    }

    // Keep the restart intent until clearing succeeds, so a failed deletion
    // cannot look like a fresh run and resurrect old progress on the next visit.
    if (search.has("restart") || restartClear.current) {
      if (!restartClear.current) {
        restartClear.current = (async () => {
          const latest = await fetchLatestSave(gameId, signal);
          await clearRestartSaves(
            accountId,
            gameId,
            [chapterId, ...(latest ? [latest.chapterId] : [])],
            ownsSession,
            signal
          );
        })();
      }
      void restartClear.current.then(
        () => {
          if (!owns()) return;
          stripRestartParam(pathname);
          safeSessionRemove(rechargeKey);
          setResolution({ phase: "ready", checkpoint: null });
        },
        (error) => {
          if (!owns()) return;
          setRestartError(error instanceof Error ? error.message : t("saveRestartFailed"));
          setResolution(
            error instanceof ApiRequestError && error.status === 409
              ? { phase: "conflict", error: error.message }
              : { phase: "restart-failed" }
          );
        }
      );
      return () => {
        cancelled = true;
      };
    }

    const resolve = async () => {
      try {
        // The storage bridge may be newer than the last acknowledged save.
        // Bind it to the revision read before top-up. A cold return must not
        // adopt another device's revision and overwrite that device's progress.
        if (search.has("recharge") && !reloadRequested.current) {
          const raw = safeSessionGet(rechargeKey);
          if (raw) {
            let saved: ExperienceAccessCheckpoint & {
              saveRevision?: number;
              contentVersion?: string;
            };
            let checkpoint: ExperienceAccessCheckpoint;
            try {
              saved = JSON.parse(raw) as typeof saved;
              checkpoint = validatedCheckpoint(runtime, saved);
            } catch {
              if (owns())
                setResolution({
                  phase: "incompatible",
                  savedChapterId: chapterId,
                  reason: "state",
                });
              return;
            }
            const slot = await channel.read(signal);
            if (!owns()) return;
            if (!Number.isSafeInteger(saved.saveRevision) || saved.saveRevision! < 0) {
              // Older storage bridges have no write precondition. Use an
              // authoritative existing save, or require an explicit reload.
              if (!slot.save)
                throw new ApiRequestError("SAVE_CONFLICT", t("saveRechargeRevisionMissing"), 409);
              try {
                checkpoint = validatedCheckpoint(runtime, slot.save);
              } catch {
                setResolution({
                  phase: "incompatible",
                  savedChapterId: chapterId,
                  reason: "state",
                });
                return;
              }
            } else if (slot.revision !== saved.saveRevision) {
              let same = false;
              if (
                slot.revision === saved.saveRevision! + 1 &&
                slot.save &&
                slot.save.contentVersion === saved.contentVersion
              ) {
                try {
                  same =
                    checkpointIdentity(validatedCheckpoint(runtime, slot.save)) ===
                    checkpointIdentity(checkpoint);
                } catch {
                  /* An incompatible server checkpoint cannot acknowledge this bridge. */
                }
              }
              if (!same)
                throw new ApiRequestError(
                  "SAVE_CONFLICT",
                  "Save has changed. Reload the latest save before trying again.",
                  409
                );
            }
            setResolution({ phase: "ready", checkpoint });
            safeSessionRemove(rechargeKey);
            return;
          }
        }

        // The URL names a chapter → this page IS that chapter's runtime; use
        // its own slot. No chapter in the URL → follow the latest-played
        // pointer, redirecting when it names a different chapter.
        let save: StorySave | null;
        if (reloadRequested.current) {
          await reloadStorySaveGame(accountId, gameId, signal);
          safeSessionRemove(rechargeKey);
          reloadRequested.current = false;
        }
        if (search.has("chapter")) {
          save = (await channel.read(signal)).save;
        } else {
          save = await fetchLatestSave(gameId, signal);
          if (save?.chapterId === chapterId) save = (await channel.read(signal)).save;
          // A null latest pointer can still have a cleared slot revision.
          if (!save) save = (await channel.read(signal)).save;
        }
        if (!owns()) return;
        if (save && save.chapterId !== chapterId && !availableChapterIds.includes(save.chapterId)) {
          setResolution({
            phase: "incompatible",
            savedChapterId: save.chapterId,
            reason: "chapter",
          });
          return;
        }
        if (!search.has("chapter") && save?.chapterId && save.chapterId !== chapterId) {
          search.set("chapter", save.chapterId);
          router.replace(`${pathname}?${search.toString()}`);
          setResolution({ phase: "redirecting" });
          return;
        }
        // Same-session unsent progress survives a SPA return. The channel read
        // has already checked that another device did not replace its revision.
        const local = channel.getPending();
        const candidate = local ?? save;
        let checkpoint: ExperienceAccessCheckpoint | null = null;
        if (candidate) {
          try {
            checkpoint = validatedCheckpoint(runtime, candidate);
          } catch {
            setResolution({ phase: "incompatible", savedChapterId: chapterId, reason: "state" });
            return;
          }
        }
        setResolution({ phase: "ready", checkpoint });
      } catch (error) {
        // A failed read is not an empty slot. Mounting fresh playback here
        // could overwrite the saved run when the connection recovers.
        if (owns())
          setResolution({
            phase:
              channel.getStatus().phase === "conflict" ||
              (error instanceof ApiRequestError && error.status === 409)
                ? "conflict"
                : "read-failed",
            error: error instanceof Error ? error.message : t("saveLoadFailed"),
          });
      }
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [
    gameId,
    chapterId,
    runtime,
    router,
    pathname,
    rechargeKey,
    availableChapterIds,
    accountId,
    ownsSession,
    t,
    readAttempt,
    channel,
  ]);

  async function restartSavedRun() {
    if (
      (resolution.phase !== "incompatible" && resolution.phase !== "restart-failed") ||
      restartPending
    )
      return;
    setRestartPending(true);
    setRestartError(null);
    const signal = requests.current?.signal;
    const clearing =
      resolution.phase === "incompatible"
        ? clearRestartSaves(
            accountId!,
            gameId,
            [chapterId, resolution.savedChapterId],
            ownsSession,
            signal
          )
        : (async () => {
            const latest = await fetchLatestSave(gameId, signal);
            await clearRestartSaves(
              accountId!,
              gameId,
              [chapterId, ...(latest ? [latest.chapterId] : [])],
              ownsSession,
              signal
            );
          })();
    restartClear.current = clearing;
    try {
      await clearing;
      if (ownsSession()) {
        stripRestartParam(pathname);
        safeSessionRemove(rechargeKey);
        setResolution({ phase: "ready", checkpoint: null });
      }
    } catch (error) {
      restartClear.current = null;
      if (ownsSession()) {
        setRestartError(error instanceof Error ? error.message : t("saveRestartFailed"));
        if (error instanceof ApiRequestError && error.status === 409)
          setResolution({ phase: "conflict", error: error.message });
      }
    } finally {
      if (ownsSession()) setRestartPending(false);
    }
  }

  // ── Save writes ───────────────────────────────────────────────────────────
  const lastPutAt = useRef(0);
  const flushTimer = useRef<number | null>(null);
  const cancelTimer = useCallback(() => {
    if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    flushTimer.current = null;
  }, []);
  const bindRechargeRevision = useCallback(
    (payload: SavePayload, revision: number) => {
      if (!accountId || !channel.ownsSession()) return;
      const raw = safeSessionGet(rechargeKey);
      if (!raw) return;
      try {
        const saved = JSON.parse(raw) as ExperienceAccessCheckpoint & { contentVersion?: string };
        if (
          saved.contentVersion !== payload.contentVersion ||
          checkpointIdentity(validatedCheckpoint(runtime, saved)) !==
            checkpointIdentity(validatedCheckpoint(runtime, payload))
        )
          return;
        sessionStorage.setItem(rechargeKey, JSON.stringify({ ...saved, saveRevision: revision }));
      } catch {
        /* An incompatible bridge remains preserved for explicit recovery. */
      }
    },
    [accountId, channel, rechargeKey, runtime]
  );
  const flushChannel = useCallback(
    (keepalive = false) => {
      // Bind the matching bridge at send time, after any older queued ACK, so
      // a cold return may recognize this exact write even if the document closes
      // before its response. An ACK then advances the bridge to its saved revision.
      return channel.flush(keepalive, bindRechargeRevision).then((result) => {
        if (result) bindRechargeRevision(result.payload, result.revision);
      });
    },
    [channel, bindRechargeRevision]
  );

  const flushSave = useCallback(() => {
    if (!accountId || !ownsSession()) return;
    cancelTimer();
    lastPutAt.current = Date.now();
    // The channel keeps the newest pending checkpoint and exposes raw errors.
    void flushChannel().catch(() => {});
  }, [accountId, ownsSession, flushChannel, cancelTimer]);

  const onCheckpoint = useCallback(
    (checkpoint: ExperienceAccessCheckpoint, reason: ExperienceCheckpointReason) => {
      if (!accountId || !ownsSession() || !ready.current) return;
      channel.replace({
        contentVersion,
        state: checkpoint.state,
        events: checkpoint.events,
        ...(checkpoint.playback ? { playback: checkpoint.playback } : {}),
        ...(checkpoint.journey ? { journey: checkpoint.journey } : {}),
      });
      const elapsed = Date.now() - lastPutAt.current;
      if (reason !== "progress" || elapsed >= SAVE_THROTTLE_MS) {
        flushSave();
      } else if (flushTimer.current === null) {
        flushTimer.current = window.setTimeout(flushSave, SAVE_THROTTLE_MS - elapsed);
      }
    },
    [accountId, ownsSession, channel, contentVersion, flushSave]
  );

  useEffect(() => {
    const onHide = () => {
      if (accountId && ownsSession()) {
        cancelTimer();
        void flushChannel(true).catch(() => {});
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      cancelTimer();
      // Reads are cancelled on unmount; this fixed-slot writer may finish for
      // the same account. The next view's read is queued behind this flush.
      if (accountId && channel.ownsSession()) void flushChannel().catch(() => {});
    };
  }, [accountId, ownsSession, channel, cancelTimer, flushChannel]);

  const onAccessCheckpoint = useCallback(
    (checkpoint: ExperienceAccessCheckpoint) => {
      if (!ownsSession()) return;
      // onCheckpoint(access) is the sole API writer. This copy only bridges
      // the top-up navigation, including the parked events and media position.
      try {
        sessionStorage.setItem(
          rechargeKey,
          JSON.stringify({
            ...checkpoint,
            ...(accountId ? { saveRevision: channel.getRevision(), contentVersion } : {}),
          })
        );
      } catch {
        /* Storage restrictions do not prevent in-page playback. */
      }
    },
    [rechargeKey, ownsSession, accountId, channel, contentVersion]
  );

  function reloadProgress() {
    cancelTimer();
    reloadRequested.current = true;
    restartClear.current = null;
    setRestartError(null);
    setPlayerGeneration((generation) => generation + 1);
    setResolution({ phase: "resolving" });
    setReadAttempt((attempt) => attempt + 1);
  }

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
      video: {
        unmute: t("video.unmute"),
        subtitles: {
          label: t("video.subtitles.label"),
          off: t("video.subtitles.off"),
          languages: {
            "zh-CN": t("video.subtitles.languages.zh-CN"),
            "zh-HK": t("video.subtitles.languages.zh-HK"),
            "en-US": t("video.subtitles.languages.en-US"),
          },
        },
      },
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
        pause: t("playback.pause"),
        resume: t("playback.resume"),
        paused: t("playback.paused"),
        continuePlaying: t("playback.continuePlaying"),
        interrupted: t("playback.interrupted"),
        transport: {
          controlsLabel: t("playback.transport.controlsLabel"),
          rewind10: t("playback.transport.rewind10"),
          forward10: t("playback.transport.forward10"),
          progressLabel: t("playback.transport.progressLabel"),
          speedLabel: t("playback.transport.speedLabel"),
          watchedOnlyHint: t("playback.transport.watchedOnlyHint"),
          interactionBlocked: t("playback.transport.interactionBlocked"),
        },
      },
    }),
    [t]
  );

  if (
    resolution.phase === "incompatible" ||
    resolution.phase === "restart-failed" ||
    resolution.phase === "read-failed" ||
    resolution.phase === "conflict"
  )
    return (
      <div className="grid h-full place-items-center bg-black px-5 text-white">
        <section role="alert" className="w-full max-w-md text-center">
          <IconAlertTriangle className="mx-auto size-8 text-amber-400" />
          <h1 className="mt-4 text-xl font-semibold">
            {t(
              resolution.phase === "conflict"
                ? "saveConflict"
                : resolution.phase === "read-failed"
                  ? "saveLoadFailed"
                  : resolution.phase === "restart-failed"
                    ? "saveRestartFailed"
                    : "saveUnavailableTitle"
            )}
          </h1>
          {resolution.phase === "incompatible" ? (
            <>
              <p className="mt-3 text-sm leading-6 text-white/65">
                {t(
                  resolution.reason === "chapter"
                    ? "saveChapterUnavailable"
                    : "saveStateUnavailable"
                )}
              </p>
              <p className="mt-2 text-sm leading-6 text-white/50">{t("savePreserved")}</p>
            </>
          ) : null}
          {restartError && resolution.phase !== "conflict" ? (
            <p className="mt-3 text-sm text-red-300">{restartError}</p>
          ) : null}
          {resolution.phase === "read-failed" || resolution.phase === "conflict" ? (
            <p className="mt-3 break-words text-sm text-red-300">{resolution.error}</p>
          ) : null}
          {resolution.phase === "conflict" || saveStatus.phase === "conflict" ? (
            <p className="mt-3 text-sm text-white/65">{t("saveConflictHint")}</p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              disabled={restartPending}
              onClick={() => {
                if (resolution.phase === "conflict" || saveStatus.phase === "conflict") {
                  stripRestartParam(pathname);
                  reloadProgress();
                } else if (resolution.phase === "read-failed") {
                  setResolution({ phase: "resolving" });
                  setReadAttempt((attempt) => attempt + 1);
                } else void restartSavedRun();
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black disabled:opacity-50"
            >
              {restartPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {resolution.phase === "conflict" || saveStatus.phase === "conflict"
                ? t("reloadSave")
                : resolution.phase === "read-failed"
                  ? commonT("retry")
                  : t("restart")}
            </button>
            <Link
              href={localizePath("/games", locale as Locale)}
              className="inline-flex min-h-11 items-center rounded-full bg-white/[0.08] px-5 text-sm"
            >
              {t("returnToGames")}
            </Link>
          </div>
        </section>
      </div>
    );
  if (resolution.phase !== "ready")
    return (
      <div className="grid h-full place-items-center text-sm text-white/60">{t("starting")}</div>
    );
  const playbackStatus =
    accountId && saveStatus.phase !== "idle" ? (
      <section
        aria-label={t("saveStatusLabel")}
        aria-live="polite"
        className="pointer-events-auto max-w-full rounded-xl border border-white/10 bg-black/85 px-3 py-2 text-xs text-white/75"
      >
        <span className="flex items-center gap-2">
          {saveStatus.phase === "saving" ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
          {t(
            saveStatus.phase === "error"
              ? "saveWriteFailed"
              : saveStatus.phase === "conflict"
                ? "saveConflict"
                : saveStatus.phase === "saved"
                  ? "saveSaved"
                  : "saveSaving"
          )}
        </span>
        {saveStatus.error ? (
          <p className="mt-1 break-words text-red-300">{saveStatus.error}</p>
        ) : null}
        {saveStatus.phase === "conflict" ? (
          <p className="mt-1 leading-5">{t("saveConflictHint")}</p>
        ) : null}
        {saveStatus.phase === "error" || saveStatus.phase === "conflict" ? (
          <button
            type="button"
            className="mt-2 min-h-8 rounded-full bg-white/10 px-3 font-medium text-white hover:bg-white/15"
            onClick={saveStatus.phase === "conflict" ? reloadProgress : flushSave}
          >
            {saveStatus.phase === "conflict" ? t("reloadSave") : commonT("retry")}
          </button>
        ) : null}
      </section>
    ) : null;
  return (
    <>
      <ExperiencePlayer
        key={playerGeneration}
        playbackStatus={playbackStatus}
        access={commerce.access}
        accessCheckpoint={resolution.checkpoint ?? undefined}
        onAccessCheckpoint={onAccessCheckpoint}
        onCheckpoint={onCheckpoint}
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

async function clearRestartSaves(
  accountId: string,
  gameId: string,
  chapterIds: string[],
  owns: () => boolean,
  signal?: AbortSignal
): Promise<void> {
  for (const chapterId of new Set(chapterIds)) {
    if (!owns() || signal?.aborted) throw new DOMException("Save session changed", "AbortError");
    const channel = getStorySaveChannel(accountId, gameId, chapterId);
    // Queue the read behind any previous page's save, then conditionally clear
    // that revision. A late write from another document hits the tombstone.
    await channel.read(signal);
    if (!owns() || signal?.aborted) throw new DOMException("Save session changed", "AbortError");
    await channel.clear();
  }
}

function validatedCheckpoint(
  runtime: ExperienceRuntimeManifest,
  source: Pick<SavePayload, "state" | "events" | "playback" | "journey">
): ExperienceAccessCheckpoint {
  if (!Array.isArray(source.events)) throw new Error("Invalid saved events.");
  const state = restoreExperienceRuntime(runtime, source.state as never);
  const playback = validateExperiencePlaybackCheckpoint(
    runtime,
    state.currentSceneId,
    source.playback
  );
  const journey = source.journey ? validateExperienceJourney(runtime, source.journey) : undefined;
  return {
    state,
    events: source.events as ExperienceAccessCheckpoint["events"],
    ...(playback ? { playback } : {}),
    ...(journey ? { journey } : {}),
  };
}

// JSONB may reorder object keys. Compare the validated logical checkpoint,
// preserving array order while ignoring object insertion order.
function checkpointIdentity(checkpoint: ExperienceAccessCheckpoint): string {
  return JSON.stringify(checkpoint, (_key, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      );
    }
    return value;
  });
}

function stripRestartParam(pathname: string): void {
  const search = new URLSearchParams(window.location.search);
  search.delete("restart");
  const nextSearch = search.toString();
  window.history.replaceState(null, "", nextSearch ? `${pathname}?${nextSearch}` : pathname);
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
