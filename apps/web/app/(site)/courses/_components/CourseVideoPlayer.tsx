"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import {
  IconArrowsMaximize,
  IconDots,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";
import {
  readLatestStoredEpisodeProgress,
  writeStoredEpisodeProgress,
} from "@/src/hooks/use-courses";
import { recomputePublicCourseProgress } from "@/src/hooks/use-courses-public";

import { DropdownMenu as Menu } from "radix-ui";
import { useTranslations } from "@/src/i18n/i18n";

interface CourseVideoPlayerProps {
  courseId: number;
  /** Course (series) id — used to refresh list-card aggregate progress. */
  seriesCourseId?: number;
  seriesVideoIds?: number[];
  title: string;
  videoUrl: string;
  /** Optional poster shown before playback / while buffering. */
  posterUrl?: string;
  stableProgressKey?: string;
}

/**
 * 将秒数格式化为视频控制栏时间。
 */
function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

/**
 * 渲染课程详情页左侧的视频播放区域和自定义控制栏。
 */
export function CourseVideoPlayer({
  courseId,
  seriesCourseId,
  seriesVideoIds,
  title,
  videoUrl,
  posterUrl,
  stableProgressKey,
}: CourseVideoPlayerProps) {
  const t = useTranslations("coursePlayerControls");
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [menuContainer, setMenuContainer] = useState<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const attachContainer = useCallback((node: HTMLElement | null) => {
    containerRef.current = node;
    setMenuContainer(node);
  }, []);
  const lastSeriesProgressWriteRef = useRef(0);

  function flushSeriesProgress() {
    if (
      seriesCourseId == null ||
      seriesCourseId <= 0 ||
      !seriesVideoIds ||
      seriesVideoIds.length === 0
    ) {
      return;
    }
    lastSeriesProgressWriteRef.current = Date.now();
    recomputePublicCourseProgress(seriesCourseId, seriesVideoIds);
  }

  useEffect(() => {
    return () => {
      flushSeriesProgress();
    };
    // Intentionally flush latest series progress when leaving the lesson.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only
  }, []);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  /**
   * 切换视频播放和暂停状态。
   */
  function togglePlay() {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }

  function handleLoadedMetadata(event: SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    video.playbackRate = rate;
    setMuted(video.muted || video.volume === 0);
    const metadataDuration = video.duration;
    setDuration(metadataDuration);

    const storedProgress = readLatestStoredEpisodeProgress(courseId, stableProgressKey);
    if (!storedProgress || !Number.isFinite(metadataDuration) || metadataDuration <= 0) return;

    const restoredTime = Math.min(storedProgress.currentTime, Math.max(metadataDuration - 1, 0));
    video.currentTime = restoredTime;
    setCurrentTime(restoredTime);
  }

  function handleTimeUpdate(event: SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    setCurrentTime(video.currentTime);

    if (courseId > 0) {
      writeStoredEpisodeProgress(
        courseId,
        {
          currentTime: video.currentTime,
          duration: video.duration,
        },
        stableProgressKey
      );

      if (
        seriesCourseId != null &&
        seriesCourseId > 0 &&
        seriesVideoIds &&
        seriesVideoIds.length > 0
      ) {
        const now = Date.now();
        if (now - lastSeriesProgressWriteRef.current >= 1500) {
          flushSeriesProgress();
        }
      }
    }
  }

  function handlePlay() {
    setPlaying(true);
  }

  function handlePause() {
    setPlaying(false);
    flushSeriesProgress();
  }

  /**
   * 将视频播放进度跳转到用户拖动的位置。
   */
  function handleSeek(value: string) {
    const video = videoRef.current;
    if (!video) return;

    const nextTime = Number(value);
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  /**
   * 将视频向前或向后跳转指定秒数。
   */
  function skipBy(seconds: number) {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = Math.min(
      Math.max(video.currentTime + seconds, 0),
      duration || video.duration
    );
  }

  /**
   * 切换视频静音状态。
   */
  function toggleMuted() {
    const video = videoRef.current;
    if (!video) return;

    const nextMuted = !(video.muted || video.volume === 0);
    if (!nextMuted && video.volume === 0) video.volume = 1;
    video.muted = nextMuted;
    setMuted(nextMuted);
  }

  /**
   * 进入或退出视频播放区全屏模式。
   */
  function toggleFullscreen() {
    const container = containerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }

    void container.requestFullscreen();
  }

  return (
    // Mobile (<lg): sticky-top so the player stays visible while the
    // page scrolls through title / description / playlist. Video itself
    // is 16:9 (`aspect-video`) so the first paint doesn't eat the whole
    // viewport. Desktop (lg+): fills its grid cell, content scrolls
    // inside the sibling panel. `top-16` mirrors the global header's
    // 4rem height — keeping this in sync is the only coupling.
    <section
      ref={attachContainer}
      className="sticky top-16 z-10 flex flex-col overflow-hidden bg-[radial-gradient(circle_at_20%_20%,#2b1832_0%,#121322_42%,#08080d_100%)] lg:static lg:top-auto lg:z-auto lg:h-full lg:min-h-0"
    >
      {videoUrl ? (
        <video
          ref={videoRef}
          key={videoUrl}
          src={videoUrl}
          poster={posterUrl || undefined}
          className="aspect-video w-full bg-black object-contain lg:aspect-auto lg:min-h-0 lg:flex-1"
          preload="metadata"
          muted={muted}
          onVolumeChange={(event) =>
            setMuted(event.currentTarget.muted || event.currentTarget.volume === 0)
          }
          onRateChange={(event) => setRate(event.currentTarget.playbackRate)}
          onClick={togglePlay}
          onPlay={handlePlay}
          onPause={handlePause}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
        />
      ) : (
        <div
          className="relative flex aspect-video w-full flex-col items-center justify-center gap-4 overflow-hidden px-6 text-center lg:aspect-auto lg:min-h-0 lg:flex-1"
          style={
            posterUrl
              ? {
                  backgroundImage: `linear-gradient(rgba(8,8,13,0.72), rgba(8,8,13,0.82)), url(${posterUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          <button
            type="button"
            className="flex size-16 items-center justify-center rounded-full bg-[#f0444c] text-black"
            onClick={togglePlay}
          >
            <IconPlayerPlayFilled className="ml-1 size-8" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">{title}</h1>
            <p className="mt-2 text-sm text-[#8f95a3]">点击播放</p>
          </div>
        </div>
      )}

      <div className="border-t border-[#20202a] bg-black px-2 py-3">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step="0.1"
          value={currentTime}
          aria-label="Video progress"
          className="h-1 w-full accent-[#f0444c]"
          style={{
            background: `linear-gradient(to right, #f0444c ${progress}%, #31313a ${progress}%)`,
          }}
          onChange={(event) => handleSeek(event.target.value)}
        />

        <div className="mt-3 flex items-center gap-3 text-xs text-[#aeb6c8]">
          <span className="min-w-20">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div className="ml-auto flex items-center gap-4">
            <button type="button" aria-label="Skip backward" onClick={() => skipBy(-10)}>
              <IconPlayerSkipBackFilled className="size-4" />
            </button>
            <button type="button" aria-label="Play or pause" onClick={togglePlay}>
              {playing ? (
                <IconPlayerPauseFilled className="size-5" />
              ) : (
                <IconPlayerPlayFilled className="size-5" />
              )}
            </button>
            <button type="button" aria-label="Skip forward" onClick={() => skipBy(10)}>
              <IconPlayerSkipForwardFilled className="size-4" />
            </button>
            <button
              type="button"
              aria-label={muted ? t("unmute") : t("mute")}
              title={muted ? t("unmute") : t("mute")}
              aria-pressed={muted}
              disabled={!videoUrl}
              onClick={toggleMuted}
              className="rounded focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-40"
            >
              {muted ? <IconVolumeOff className="size-4" /> : <IconVolume className="size-4" />}
            </button>
            <Menu.Root key={videoUrl}>
              <Menu.Trigger asChild>
                <button
                  type="button"
                  aria-label={t("options")}
                  title={t("options")}
                  disabled={!videoUrl}
                  className="rounded focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-40"
                >
                  <IconDots className="size-5" />
                </button>
              </Menu.Trigger>
              <Menu.Portal container={menuContainer}>
                <Menu.Content
                  side="top"
                  align="end"
                  sideOffset={8}
                  collisionPadding={8}
                  className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-36 overflow-y-auto rounded-lg border border-white/10 bg-[#18181b] p-1 text-xs text-white shadow-lg"
                >
                  <Menu.Label className="px-2 py-1.5 text-white/60">{t("speed")}</Menu.Label>
                  <Menu.RadioGroup
                    value={String(rate)}
                    onValueChange={(value) => {
                      const video = videoRef.current;
                      if (!video) return;
                      video.playbackRate = Number(value);
                      setRate(video.playbackRate);
                    }}
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                      <Menu.RadioItem
                        key={speed}
                        value={String(speed)}
                        className="flex cursor-default items-center justify-between gap-4 rounded px-2 py-1.5 outline-none focus:bg-white/10"
                      >
                        {speed === 1 ? t("normal") : `${speed}×`}
                        <Menu.ItemIndicator aria-hidden>✓</Menu.ItemIndicator>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
            <button type="button" aria-label="Fullscreen" onClick={toggleFullscreen}>
              <IconArrowsMaximize className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
