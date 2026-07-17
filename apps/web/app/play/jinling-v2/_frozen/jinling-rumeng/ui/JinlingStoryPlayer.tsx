"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import {
  IconArrowLeft,
  IconChevronRight,
  IconPlayerPlayFilled,
  IconRefresh,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";
import { useTranslations } from "../../i18n/translations";
import {
  applyJinlingStoryEffects,
  createJinlingStoryProgress,
  endingVideo,
  JinlingStoryProgressSchema,
  jinlingStoryChapter,
  jinlingStoryStorageKey,
  JINLING_STORY_CHAPTERS,
  resolveJinlingEnding,
  type JinlingEndingId,
  type JinlingStoryChoice,
  type JinlingStoryProgress,
} from "../content/fast-story";

type JinlingStoryPlayerProps = {
  sessionId: string;
  playerName: string;
  onExit: () => void;
};

type PendingChoice = {
  choice: JinlingStoryChoice;
  endingId: JinlingEndingId | null;
};

function loadProgress(storageKey: string): JinlingStoryProgress {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return createJinlingStoryProgress();
  try {
    return JinlingStoryProgressSchema.parse(JSON.parse(raw));
  } catch {
    window.localStorage.removeItem(storageKey);
    return createJinlingStoryProgress();
  }
}

export function JinlingStoryPlayer({ sessionId, playerName, onExit }: JinlingStoryPlayerProps) {
  const t = useTranslations("jinlingRumeng.story");
  const storageKey = useMemo(() => jinlingStoryStorageKey(sessionId), [sessionId]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState<JinlingStoryProgress>(createJinlingStoryProgress);
  const [ready, setReady] = useState(false);
  const [chapterPlaybackRatio, setChapterPlaybackRatio] = useState(0);
  const [choiceReady, setChoiceReady] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<PendingChoice | null>(null);
  const [muted, setMuted] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [failedVideoKey, setFailedVideoKey] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const chapter = jinlingStoryChapter(progress.chapterId);
  const chapterIndex = JINLING_STORY_CHAPTERS.findIndex(
    (candidate) => candidate.chapterId === chapter.chapterId
  );
  const activeVideo = pendingChoice
    ? pendingChoice.endingId
      ? endingVideo(pendingChoice.endingId)
      : pendingChoice.choice.reactionVideo
    : chapter.video;
  const activeVideoKey = pendingChoice
    ? `reaction:${pendingChoice.choice.choiceId}:${pendingChoice.endingId ?? "next"}:${retryNonce}`
    : `chapter:${chapter.chapterId}:${retryNonce}`;
  const videoFailed = failedVideoKey === activeVideoKey;
  const completedBeforeChapter = JINLING_STORY_CHAPTERS.slice(0, chapterIndex).reduce(
    (total, item) => total + item.clips.length,
    0
  );
  const watchedMainClips = Math.min(
    24,
    completedBeforeChapter + Math.max(1, Math.ceil(chapterPlaybackRatio * chapter.clips.length))
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setProgress(loadProgress(storageKey));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(storageKey, JSON.stringify(progress));
  }, [progress, ready, storageKey]);

  useEffect(() => {
    setChapterPlaybackRatio(0);
    setChoiceReady(false);
    setPendingChoice(null);
    setPlaybackBlocked(false);
    setFailedVideoKey(null);
  }, [progress.chapterId]);

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

  useEffect(() => {
    if (!choiceReady || chapter.chapterId !== "c4") return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, video.duration - 3);
    void video.play().catch(() => undefined);
  }, [chapter.chapterId, choiceReady]);

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
    const { choice, endingId } = pendingChoice;
    setProgress((current) => {
      const scores = applyJinlingStoryEffects(current.scores, choice.effects);
      const history = [...current.history, `${current.chapterId}:${choice.choiceId}`];
      if (endingId) return { ...current, scores, history, endingId };
      if (!choice.nextChapterId) throw new Error(`Choice ${choice.choiceId} has no destination`);
      return { ...current, chapterId: choice.nextChapterId, scores, history };
    });
    setPendingChoice(null);
  }, [pendingChoice]);

  const choose = (choice: JinlingStoryChoice) => {
    const scores = applyJinlingStoryEffects(progress.scores, choice.effects);
    const endingId = choice.finalAction ? resolveJinlingEnding(scores, choice.finalAction) : null;
    setChoiceReady(false);
    setPlaybackBlocked(false);
    setFailedVideoKey(null);
    setPendingChoice({ choice, endingId });
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
    const next = createJinlingStoryProgress();
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    setChapterPlaybackRatio(0);
    setChoiceReady(false);
    setProgress(next);
  };

  if (!ready) return <div className="fixed inset-0 z-50 bg-black" />;

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
          poster={chapter.poster}
          autoPlay
          muted={muted}
          playsInline
          preload="auto"
          className="absolute inset-0 size-full object-cover object-center"
          onCanPlay={(event) => {
            event.currentTarget.muted = muted;
            void event.currentTarget.play().then(
              () => setPlaybackBlocked(false),
              () => setPlaybackBlocked(true)
            );
          }}
          onTimeUpdate={(event) => {
            if (!pendingChoice && event.currentTarget.duration > 0) {
              setChapterPlaybackRatio(
                Math.min(1, event.currentTarget.currentTime / event.currentTarget.duration)
              );
            }
            if (
              choiceReady &&
              chapter.chapterId === "c4" &&
              event.currentTarget.duration - event.currentTarget.currentTime < 0.12
            ) {
              event.currentTarget.currentTime = Math.max(0, event.currentTarget.duration - 3);
              void event.currentTarget.play().catch(() => undefined);
            }
          }}
          onEnded={() => {
            if (pendingChoice) {
              finishReaction();
              return;
            }
            setChoiceReady(true);
          }}
          onError={() => setFailedVideoKey(activeVideoKey)}
        />
      ) : (
        <NextImage
          src={chapter.poster}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
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
              {t("cut.progress", { current: watchedMainClips, total: 24 })}
            </p>
            <div className="mt-2 h-px w-28 bg-white/20 sm:w-40">
              <span
                className="block h-px bg-[#b64749] transition-[width] duration-500"
                style={{ width: `${(watchedMainClips / 24) * 100}%` }}
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
