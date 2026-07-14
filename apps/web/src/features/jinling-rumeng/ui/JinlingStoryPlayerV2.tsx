"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import {
  IconArrowLeft,
  IconChevronRight,
  IconDeviceMobileRotated,
  IconPlayerPlayFilled,
  IconRefresh,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  createJinlingV2StoryProgress,
  JinlingV2StoryProgressSchema,
  jinlingV2StoryChapter,
  jinlingV2StoryStorageKey,
  JINLING_V2_CHAPTERS,
  type JinlingV2Choice,
  type JinlingV2StoryProgress,
} from "../content/fast-story-v2";

const MAINLINE_TOTAL = JINLING_V2_CHAPTERS.reduce(
  (total, chapter) => total + chapter.clips.length,
  0
);

type JinlingStoryPlayerV2Props = {
  sessionId: string;
  playerName: string;
  onExit: () => void;
};

function loadProgress(storageKey: string): JinlingV2StoryProgress {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return createJinlingV2StoryProgress();
  try {
    return JinlingV2StoryProgressSchema.parse(JSON.parse(raw));
  } catch {
    window.localStorage.removeItem(storageKey);
    return createJinlingV2StoryProgress();
  }
}

/**
 * Preload a set of clip URLs to first-frame readiness (loadeddata). Drives the
 * enter-game loading gate (current chapter) and background prefetch of the next
 * chapter while a reaction plays. Resolves on all-ready or a timeout — the game
 * never hangs on a slow/broken asset; playback keeps buffering after first frame.
 */
function preloadVideos(urls: string[], timeoutMs = 25000): Promise<void> {
  return new Promise((resolve) => {
    const pending = urls.filter(Boolean);
    if (pending.length === 0) {
      resolve();
      return;
    }
    let remaining = pending.length;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    pending.forEach((url) => {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      const onDone = () => {
        video.removeEventListener("loadeddata", onDone);
        video.removeEventListener("error", onDone);
        remaining -= 1;
        if (remaining <= 0) finish();
      };
      video.addEventListener("loadeddata", onDone);
      video.addEventListener("error", onDone);
      video.src = url;
      video.load();
    });
  });
}

/**
 * v2 player: same shell as v1 but the data source is a per-clip graph, so each
 * chapter plays its `clips[]` in order before choices appear (v1 played one
 * pre-composed chapter video). Endings are deterministic — the final choice
 * carries its own endingId, no scoring. While the player deliberates, a chapter
 * loops its `waitVideo` if present, else it holds on the last clip's final frame.
 */
export function JinlingStoryPlayerV2({ sessionId, playerName, onExit }: JinlingStoryPlayerV2Props) {
  const t = useTranslations("jinlingRumeng.storyV2");
  const storageKey = useMemo(() => jinlingV2StoryStorageKey(sessionId), [sessionId]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState<JinlingV2StoryProgress>(createJinlingV2StoryProgress);
  const [ready, setReady] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [needsRotate, setNeedsRotate] = useState(false);
  const [clipIndex, setClipIndex] = useState(0);
  const [choiceReady, setChoiceReady] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<JinlingV2Choice | null>(null);
  const [muted, setMuted] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [failedVideoKey, setFailedVideoKey] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const chapter = jinlingV2StoryChapter(progress.chapterId);
  const chapterIndex = JINLING_V2_CHAPTERS.findIndex(
    (candidate) => candidate.chapterId === chapter.chapterId
  );
  const safeClipIndex = Math.min(clipIndex, chapter.clips.length - 1);
  const showWait = choiceReady && !pendingChoice && Boolean(chapter.waitVideo);
  const activeVideo = pendingChoice
    ? pendingChoice.reactionVideo
    : showWait
      ? (chapter.waitVideo as string)
      : chapter.clips[safeClipIndex].video;
  const activeVideoKey = pendingChoice
    ? `reaction:${pendingChoice.choiceId}:${retryNonce}`
    : showWait
      ? `wait:${chapter.chapterId}:${retryNonce}`
      : `clip:${chapter.chapterId}:${safeClipIndex}:${retryNonce}`;
  const videoFailed = failedVideoKey === activeVideoKey;
  const completedBeforeChapter = JINLING_V2_CHAPTERS.slice(0, chapterIndex).reduce(
    (total, item) => total + item.clips.length,
    0
  );
  const watchedMainClips = Math.min(MAINLINE_TOTAL, completedBeforeChapter + safeClipIndex + 1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setProgress(loadProgress(storageKey));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  // A 16:9 cinematic cut needs landscape. On a touch phone held portrait, prompt
  // the user to rotate (reliable on both iOS and Android) instead of cropping the
  // frame. Desktop portrait windows (fine-pointer) are never prompted.
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait) and (pointer: coarse)");
    const update = () => setNeedsRotate(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Progressive enhancement: on the first touch, best-effort request fullscreen +
  // lock landscape. Works on Android Chrome; iOS Safari has no lock API and throws
  // — caught silently, the rotate prompt above covers that case.
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    let used = false;
    const enterImmersive = () => {
      if (used) return;
      used = true;
      window.removeEventListener("pointerdown", enterImmersive);
      void (async () => {
        try {
          const root = document.documentElement;
          if (!document.fullscreenElement && root.requestFullscreen) {
            await root.requestFullscreen();
          }
          const orientation = screen.orientation as ScreenOrientation & {
            lock?: (o: string) => Promise<void>;
          };
          await orientation?.lock?.("landscape");
        } catch {
          /* unsupported (iOS) — rotate prompt handles it */
        }
      })();
    };
    window.addEventListener("pointerdown", enterImmersive);
    return () => window.removeEventListener("pointerdown", enterImmersive);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(storageKey, JSON.stringify(progress));
  }, [progress, ready, storageKey]);

  useEffect(() => {
    setClipIndex(0);
    setChoiceReady(false);
    setPendingChoice(null);
    setPlaybackBlocked(false);
    setFailedVideoKey(null);
  }, [progress.chapterId]);

  // Enter-game loading gate: preload the (resumed) current chapter's clips to
  // first frame before revealing the film. Runs once, when the saved progress
  // has loaded; later chapters are covered by the prefetch below, so they don't
  // re-gate. Endings skip the gate (the reaction is already preloaded).
  useEffect(() => {
    if (!ready || progress.endingId) {
      setMediaLoading(false);
      return;
    }
    let cancelled = false;
    const urls = chapter.clips.map((clip) => clip.video);
    if (chapter.waitVideo) urls.push(chapter.waitVideo);
    void preloadVideos(urls).then(() => {
      if (!cancelled) setMediaLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Background prefetch: while a reaction plays (~12s), warm the next chapter's
  // clips so the transition into it is instant (cache hit, no loading gate).
  useEffect(() => {
    if (!pendingChoice?.nextChapterId) return;
    const next = JINLING_V2_CHAPTERS.find(
      (candidate) => candidate.chapterId === pendingChoice.nextChapterId
    );
    if (!next) return;
    const urls = next.clips.map((clip) => clip.video);
    if (next.waitVideo) urls.push(next.waitVideo);
    void preloadVideos(urls);
  }, [pendingChoice]);

  useEffect(() => {
    if (!choiceReady || pendingChoice || progress.endingId) return;
    const preloads = chapter.choices.map((choice) => {
      const preload = document.createElement("video");
      preload.preload = "auto";
      preload.src = choice.reactionVideo;
      preload.load();
      return preload;
    });
    return () => {
      preloads.forEach((preload) => {
        preload.removeAttribute("src");
        preload.load();
      });
    };
  }, [chapter.choices, choiceReady, pendingChoice, progress.endingId]);

  const resumeVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    void video.play().then(
      () => setPlaybackBlocked(false),
      () => setPlaybackBlocked(true)
    );
  }, [muted]);

  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    if (!videoRef.current) return;
    videoRef.current.muted = next;
    if (videoRef.current.paused && !choiceReady) resumeVideo();
  };

  const finishReaction = useCallback(() => {
    if (!pendingChoice) return;
    const choice = pendingChoice;
    setProgress((current) => {
      const history = [...current.history, `${current.chapterId}:${choice.choiceId}`];
      if (choice.endingId) return { ...current, history, endingId: choice.endingId };
      if (!choice.nextChapterId) throw new Error(`Choice ${choice.choiceId} has no destination`);
      return { ...current, chapterId: choice.nextChapterId, history };
    });
    setPendingChoice(null);
  }, [pendingChoice]);

  const advanceMain = useCallback(() => {
    if (safeClipIndex < chapter.clips.length - 1) {
      setClipIndex((index) => index + 1);
      return;
    }
    setChoiceReady(true);
  }, [chapter.clips.length, safeClipIndex]);

  const choose = (choice: JinlingV2Choice) => {
    setChoiceReady(false);
    setPlaybackBlocked(false);
    setFailedVideoKey(null);
    setPendingChoice(choice);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!choiceReady || pendingChoice || progress.endingId) return;
      const choice = chapter.choices[Number(event.key) - 1];
      if (!choice) return;
      event.preventDefault();
      choose(choice);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const restart = () => {
    const next = createJinlingV2StoryProgress();
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    setClipIndex(0);
    setChoiceReady(false);
    setPendingChoice(null);
    setProgress(next);
  };

  if (needsRotate && !progress.endingId) {
    return (
      <section className="fixed inset-0 z-[60] grid place-items-center bg-black px-8 text-center text-[#f4ecdc]">
        <div className="flex flex-col items-center gap-6">
          <IconDeviceMobileRotated size={44} className="animate-pulse text-white/70" stroke={1.4} />
          <p
            className="text-2xl tracking-[0.06em] text-[#f0e4cc]"
            style={{ fontFamily: '"Noto Serif SC", "Songti SC", ui-serif, Georgia, serif' }}
          >
            {t("rotate.title")}
          </p>
          <p className="max-w-xs text-sm leading-6 text-white/55">{t("rotate.hint")}</p>
        </div>
      </section>
    );
  }

  if (!ready || mediaLoading) {
    return (
      <section className="fixed inset-0 z-50 grid place-items-center bg-black text-[#f4ecdc]">
        <div className="flex flex-col items-center gap-5">
          <span className="size-8 animate-spin rounded-full border-2 border-white/15 border-t-[#b64749]" />
          <p className="text-[11px] uppercase tracking-[0.34em] text-white/48">{t("loading")}</p>
        </div>
      </section>
    );
  }

  if (progress.endingId) {
    return (
      <section className="fixed inset-0 z-50 overflow-hidden bg-[#030608] text-[#f4ecdc]">
        <NextImage
          src="/jinling-rumeng/preview/story/ending-water.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,5,7,0.96)_0%,rgba(2,5,7,0.76)_45%,rgba(2,5,7,0.25)_100%)]" />
        <div className="relative flex min-h-dvh items-center px-6 py-20 sm:px-12 lg:px-20">
          <div className="max-w-2xl border-l border-[#a52a2e]/65 pl-6 sm:pl-9">
            <p className="text-[11px] uppercase tracking-[0.36em] text-[#d5c39e]/58">
              {t("ending.eyebrow")}
            </p>
            <h1
              className="mt-5 text-5xl leading-tight tracking-[0.08em] text-[#f0e4cc] sm:text-6xl"
              style={{ fontFamily: '"Noto Serif SC", "Songti SC", ui-serif, Georgia, serif' }}
            >
              {t(`endings.${progress.endingId}.title`)}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-white/68">
              {t(`endings.${progress.endingId}.body`, { name: playerName })}
            </p>
            <p className="mt-6 text-xs leading-6 text-white/38">
              {t("ending.path", { count: progress.history.length })}
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={restart}
                className="inline-flex min-h-12 items-center gap-3 bg-[#e9ddc5] px-5 text-sm font-semibold text-[#211a12] transition hover:bg-[#f3e8d2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
              >
                <IconRefresh size={17} />
                {t("ending.restart")}
              </button>
              <button
                type="button"
                onClick={onExit}
                className="inline-flex min-h-12 items-center gap-3 border border-white/15 px-5 text-sm text-white/72 transition hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
              >
                <IconArrowLeft size={17} />
                {t("ending.exit")}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="fixed inset-0 z-50 overflow-hidden bg-black text-[#f4ecdc]">
      {!videoFailed ? (
        <video
          key={activeVideoKey}
          ref={videoRef}
          src={activeVideo}
          autoPlay
          muted={muted}
          playsInline
          preload="auto"
          loop={showWait}
          className="absolute inset-0 size-full object-cover object-center"
          onCanPlay={(event) => {
            event.currentTarget.muted = muted;
            void event.currentTarget.play().then(
              () => setPlaybackBlocked(false),
              () => setPlaybackBlocked(true)
            );
          }}
          onEnded={() => {
            if (pendingChoice) {
              finishReaction();
              return;
            }
            if (showWait) return;
            advanceMain();
          }}
          onError={() => setFailedVideoKey(activeVideoKey)}
        />
      ) : (
        <div className="absolute inset-0 bg-[#050809]" />
      )}

      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_140px_rgba(0,0,0,0.42)]" />
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/65 to-transparent px-4 pb-12 pt-4 sm:px-7 sm:pt-6">
        <button
          type="button"
          onClick={onExit}
          className="inline-flex min-h-11 items-center gap-2 border border-white/12 bg-black/30 px-4 text-sm text-white/72 backdrop-blur-md transition hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
        >
          <IconArrowLeft size={17} />
          {t("exit")}
        </button>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={toggleMuted}
            aria-label={t(muted ? "sound.enable" : "sound.disable")}
            className="grid size-11 place-items-center border border-white/12 bg-black/30 text-white/72 backdrop-blur-md transition hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
          >
            {muted ? <IconVolumeOff size={18} /> : <IconVolume size={18} />}
          </button>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.28em] text-white/50">
              {t("cut.progress", { current: watchedMainClips, total: MAINLINE_TOTAL })}
            </p>
            <div className="mt-2 h-px w-28 bg-white/20 sm:w-40">
              <span
                className="block h-px bg-[#b64749] transition-[width] duration-500"
                style={{ width: `${(watchedMainClips / MAINLINE_TOTAL) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      {playbackBlocked && !videoFailed ? (
        <button
          type="button"
          onClick={resumeVideo}
          className="absolute inset-0 z-30 grid place-items-center bg-black/32 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e] focus-visible:ring-inset"
        >
          <span className="inline-flex min-h-12 items-center gap-3 border border-white/20 bg-black/62 px-5 text-sm tracking-[0.08em] backdrop-blur-md">
            <IconPlayerPlayFilled size={17} />
            {t("sound.resume")}
          </span>
        </button>
      ) : null}

      {videoFailed ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/58 px-6">
          <div className="max-w-md border-l border-[#b64749]/70 bg-black/65 px-6 py-5 backdrop-blur-md">
            <p role="alert" className="text-sm leading-6 text-white/72">
              {t("reactionFailed")}
            </p>
            <button
              type="button"
              onClick={() => {
                setFailedVideoKey(null);
                setRetryNonce((value) => value + 1);
              }}
              className="mt-4 inline-flex min-h-11 items-center gap-2 border border-white/18 px-4 text-sm text-white/78 transition hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
            >
              <IconRefresh size={16} />
              {t("reactionRetry")}
            </button>
          </div>
        </div>
      ) : null}

      {pendingChoice ? (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-20 -translate-x-1/2 border-l border-[#b64749]/55 bg-black/48 px-5 py-3 text-xs tracking-[0.18em] text-white/66 backdrop-blur-md">
          {t("reactionPlaying")}
        </div>
      ) : null}

      {choiceReady && !pendingChoice ? (
        <div className="absolute inset-0 z-20 flex items-end bg-[linear-gradient(180deg,transparent_20%,rgba(0,0,0,0.28)_48%,rgba(0,0,0,0.94)_100%)] px-4 pb-5 pt-28 sm:px-8 sm:pb-9 lg:px-14 lg:pb-12">
          <div className="mx-auto grid w-full max-w-[1420px] items-end gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(380px,560px)] lg:gap-16">
            <div className="max-w-2xl">
              <p className="text-[10px] uppercase tracking-[0.36em] text-[#d2c19f]/70">
                {t(`cut.chapters.${chapter.chapterId}.eyebrow`)}
              </p>
              <h1
                className="mt-3 text-3xl leading-tight tracking-[0.08em] text-[#f2e7cf] sm:text-5xl"
                style={{ fontFamily: '"Noto Serif SC", "Songti SC", ui-serif, Georgia, serif' }}
              >
                {t(`cut.chapters.${chapter.chapterId}.title`)}
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-white/65 sm:text-base">
                {t(`cut.chapters.${chapter.chapterId}.body`, { name: playerName })}
              </p>
            </div>
            <div className="grid gap-2">
              <p className="mb-1 text-[10px] uppercase tracking-[0.3em] text-white/45">
                {t("choose")}
              </p>
              {chapter.choices.map((choice, index) => (
                <button
                  key={choice.choiceId}
                  type="button"
                  onClick={() => choose(choice)}
                  className="group grid min-h-13 grid-cols-[24px_1fr_20px] items-center gap-3 border border-white/13 bg-black/54 px-4 py-3 text-left text-sm text-white/78 backdrop-blur-md transition hover:border-[#b64749]/70 hover:bg-black/72 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e]"
                >
                  <span className="font-mono text-[10px] text-[#cf7779]">{index + 1}</span>
                  <span className="leading-6">
                    {t(`cut.chapters.${chapter.chapterId}.choices.${choice.choiceId}`)}
                  </span>
                  <IconChevronRight
                    className="text-white/35 transition group-hover:translate-x-1 group-hover:text-white"
                    size={17}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
