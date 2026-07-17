"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RuntimeImageAsset,
  RuntimeVideoAsset,
  RuntimeVideoSequenceClip,
} from "../domain/release-manifest";
import { FilmStage, type FilmStageError, type FilmStageState } from "./film-stage";
import type { StableVideoFrameHandler } from "./stable-video";

export type ResolvedFilmSequenceClip = RuntimeVideoSequenceClip & {
  asset: RuntimeVideoAsset;
  poster?: RuntimeImageAsset;
  loopAsset?: RuntimeVideoAsset;
};

type FilmSequenceStageProps = {
  clips: ResolvedFilmSequenceClip[];
  poster: RuntimeImageAsset;
  playbackId: string | number;
  reduceMotion: boolean;
  muted: boolean;
  fit?: "cover" | "contain";
  className?: string;
  resumeLabel: string;
  onClipChange?: (clipId: string, index: number) => void;
  onClipStateChange?: (clipId: string, state: FilmStageState) => void;
  onVideoFrame?: (clipId: string, video: HTMLVideoElement) => void;
  onSequenceComplete?: () => void;
  onError: (error: FilmStageError) => void;
};

type SequencePlaybackState = {
  key: string;
  clipIndex: number;
  loopAsset: RuntimeVideoAsset | null;
};

function sequenceKey(playbackId: string | number, clips: ResolvedFilmSequenceClip[]): string {
  return `${String(playbackId)}:${clips.map((clip) => clip.clipId).join("|")}`;
}

export function FilmSequenceStage({
  clips,
  poster,
  playbackId,
  reduceMotion,
  muted,
  fit = "contain",
  className,
  resumeLabel,
  onClipChange,
  onClipStateChange,
  onVideoFrame,
  onSequenceComplete,
  onError,
}: FilmSequenceStageProps) {
  if (clips.length === 0) throw new Error("FilmSequenceStage requires at least one clip");

  const key = sequenceKey(playbackId, clips);
  const [snapshot, setSnapshot] = useState<SequencePlaybackState>(() => ({
    key,
    clipIndex: 0,
    loopAsset: null,
  }));
  const state = snapshot.key === key ? snapshot : { key, clipIndex: 0, loopAsset: null };
  const completionKeyRef = useRef<string | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const current = clips[state.clipIndex] ?? clips[clips.length - 1]!;
  const activeAsset = state.loopAsset ?? current.asset;
  const activePoster = current.poster ?? poster;
  const activePlaybackId = `${key}:${state.clipIndex}:${state.loopAsset?.assetId ?? "entry"}`;
  const frameHandler = useMemo<StableVideoFrameHandler | undefined>(
    () => (onVideoFrame ? (video) => onVideoFrame(current.clipId, video) : undefined),
    [current.clipId, onVideoFrame]
  );

  const clearHoldTimer = () => {
    if (holdTimerRef.current === null) return;
    window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  };

  const notifyComplete = () => {
    if (completionKeyRef.current === key) return;
    completionKeyRef.current = key;
    onSequenceComplete?.();
  };

  const advance = () => {
    clearHoldTimer();
    if (state.clipIndex >= clips.length - 1) {
      notifyComplete();
      return;
    }
    setSnapshot({
      key,
      clipIndex: state.clipIndex + 1,
      loopAsset: null,
    });
  };

  useEffect(() => {
    completionKeyRef.current = null;
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    return () => {
      if (holdTimerRef.current === null) return;
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    };
  }, [key]);

  useEffect(() => {
    onClipChange?.(current.clipId, state.clipIndex);
  }, [current.clipId, onClipChange, state.clipIndex]);

  useEffect(() => {
    if (!reduceMotion) return;
    notifyComplete();
    // Reduced-motion playback deliberately resolves to the authored poster.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduceMotion]);

  useEffect(() => {
    const next = clips[state.clipIndex + 1]?.asset.variants.landscape;
    if (!next) return;
    const preload = document.createElement("video");
    preload.preload = "auto";
    preload.muted = true;
    preload.src = next.src;
    preload.load();
    return () => {
      preload.removeAttribute("src");
      preload.load();
    };
  }, [clips, state.clipIndex]);

  const handleEntryEnded = () => {
    if (state.loopAsset) return;
    const behavior = current.endBehavior;
    if (behavior.behavior === "advance") {
      advance();
      return;
    }
    if (behavior.behavior === "hold-last-frame") {
      if (!behavior.durationMs) {
        notifyComplete();
        return;
      }
      clearHoldTimer();
      holdTimerRef.current = window.setTimeout(advance, behavior.durationMs);
      return;
    }
    if (behavior.behavior === "loop-tail") {
      notifyComplete();
      return;
    }
    if (!current.loopAsset) {
      onError({
        code: "MEDIA_LOAD_FAILED",
        message: `Sequence clip ${current.clipId} is missing wait-loop asset ${behavior.assetId}.`,
      });
      return;
    }
    setSnapshot({ ...state, loopAsset: current.loopAsset });
    notifyComplete();
  };

  return (
    <div
      className={className}
      data-film-sequence-clip={current.clipId}
      data-film-sequence-index={state.clipIndex}
      data-film-sequence-waiting={state.loopAsset ? "loop-asset" : current.endBehavior.behavior}
    >
      <FilmStage
        clip={activeAsset}
        poster={activePoster}
        playbackId={activePlaybackId}
        reduceMotion={reduceMotion}
        muted={muted}
        loop={Boolean(state.loopAsset)}
        tailLoopSeconds={
          !state.loopAsset && current.endBehavior.behavior === "loop-tail"
            ? current.endBehavior.tailSeconds
            : undefined
        }
        fit={fit}
        className="absolute inset-0"
        resumeLabel={resumeLabel}
        onStateChange={(nextState) => onClipStateChange?.(current.clipId, nextState)}
        onVideoFrame={frameHandler}
        onEnded={handleEntryEnded}
        onError={onError}
      />
    </div>
  );
}
