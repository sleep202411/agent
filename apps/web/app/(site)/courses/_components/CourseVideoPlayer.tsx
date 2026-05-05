"use client";

import { useRef, useState, type SyntheticEvent } from "react";
import {
  IconArrowsMaximize,
  IconDots,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconVolume,
} from "@tabler/icons-react";
import {
  readLatestStoredEpisodeProgress,
  writeStoredEpisodeProgress,
} from "@/src/hooks/use-courses";

interface CourseVideoPlayerProps {
  courseId: number;
  title: string;
  videoUrl: string;
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
  title,
  videoUrl,
  stableProgressKey,
}: CourseVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLElement>(null);
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
    }
  }

  function handlePlay() {
    setPlaying(true);
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

    video.muted = !video.muted;
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
    <section
      ref={containerRef}
      className="relative flex h-full min-h-[420px] flex-col overflow-hidden bg-[radial-gradient(circle_at_20%_20%,#2b1832_0%,#121322_42%,#08080d_100%)] lg:min-h-0"
    >
      {videoUrl ? (
        <video
          ref={videoRef}
          key={videoUrl}
          src={videoUrl}
          className="min-h-0 flex-1 bg-black object-contain"
          preload="metadata"
          onClick={togglePlay}
          onPlay={handlePlay}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
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
            <button type="button" aria-label="Mute" onClick={toggleMuted}>
              <IconVolume className="size-4" />
            </button>
            <button type="button" aria-label="More options">
              <IconDots className="size-5" />
            </button>
            <button type="button" aria-label="Fullscreen" onClick={toggleFullscreen}>
              <IconArrowsMaximize className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
