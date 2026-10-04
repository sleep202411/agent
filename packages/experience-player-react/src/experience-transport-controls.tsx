"use client";

import { useId, type ReactNode } from "react";
import { IconRewindBackward10, IconRewindForward10 } from "@tabler/icons-react";
import { classNames } from "./class-names";
import type { ExperiencePlayerTransportCopy } from "./experience-player-copy";

export interface ExperiencePlaybackTransportControlsProps {
  copy: ExperiencePlayerTransportCopy;
  /** Positions within the current clip, never the entire story. */
  positionMs: number;
  durationMs: number;
  /** The furthest position the viewer may seek to within this clip. */
  seekLimitMs: number;
  rate: number;
  disabled?: boolean;
  disabledReason?: string;
  onSeek: (positionMs: number) => void;
  onRate: (rate: number) => void;
  trailingControls?: ReactNode;
}

const RATES = [1, 1.25, 1.5, 2] as const;
const CONTROL =
  "min-h-11 rounded-full text-white/90 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent motion-reduce:transition-none";

/** The host places this strip clear of the story's choices and gestures. */
export function ExperiencePlaybackTransportControls({
  copy,
  positionMs,
  durationMs,
  seekLimitMs,
  rate,
  disabled = false,
  disabledReason,
  onSeek,
  onRate,
  trailingControls,
}: ExperiencePlaybackTransportControlsProps) {
  const hintId = useId();
  const duration = nonnegativeFinite(durationMs);
  const position = Math.min(nonnegativeFinite(positionMs), duration);
  const seekLimit = Math.min(nonnegativeFinite(seekLimitMs), duration);
  const seekDisabled = disabled || duration === 0 || seekLimit === 0;
  const hint = disabled ? (disabledReason ?? copy.interactionBlocked) : null;
  const watchedHint = duration > 0 && seekLimit < duration ? copy.watchedOnlyHint : null;
  const description = [hint, watchedHint].filter(Boolean).join(" ");
  const percentage = duration > 0 ? (position / duration) * 100 : 0;
  const watchedPercentage = duration > 0 ? (seekLimit / duration) * 100 : 0;
  const currentRate = RATES.find((option) => option === rate) ?? 1;
  const nextRate = RATES[(RATES.indexOf(currentRate) + 1) % RATES.length]!;

  const seek = (target: number) => {
    if (!seekDisabled && Number.isFinite(target)) {
      onSeek(Math.round(Math.min(Math.max(0, target), seekLimit)));
    }
  };

  return (
    <div
      role="group"
      aria-label={copy.controlsLabel}
      data-experience-transport-controls=""
      className="pointer-events-auto w-full bg-gradient-to-b from-transparent to-black/60 px-2 text-white/90 sm:px-3"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex h-11 items-center gap-1 sm:gap-2">
        <button
          type="button"
          aria-label={copy.rewind10}
          title={[copy.rewind10, description].filter(Boolean).join(". ")}
          aria-describedby={description ? hintId : undefined}
          disabled={seekDisabled || position <= 0}
          onClick={() => seek(position - 10_000)}
          className={classNames(CONTROL, "grid size-11 shrink-0 place-items-center")}
        >
          <IconRewindBackward10 className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={copy.forward10}
          title={[copy.forward10, description].filter(Boolean).join(". ")}
          aria-describedby={description ? hintId : undefined}
          disabled={seekDisabled || position >= seekLimit}
          onClick={() => seek(position + 10_000)}
          className={classNames(CONTROL, "grid size-11 shrink-0 place-items-center")}
        >
          <IconRewindForward10 className="size-5" aria-hidden="true" />
        </button>
        <span
          className="shrink-0 whitespace-nowrap text-[11px] tabular-nums sm:text-xs"
          aria-hidden="true"
        >
          {formatTime(position)}
          <span className="hidden min-[360px]:inline"> / {formatTime(duration)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={duration}
          step={100}
          value={position}
          disabled={seekDisabled}
          aria-label={copy.progressLabel}
          aria-valuetext={`${formatTime(position)} / ${formatTime(duration)}`}
          aria-describedby={description ? hintId : undefined}
          title={[copy.progressLabel, description].filter(Boolean).join(". ")}
          onChange={(event) => seek(Number(event.currentTarget.value))}
          className="block h-11 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent bg-[length:100%_3px] bg-center bg-no-repeat outline-none focus-visible:rounded-full focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-40 [&::-moz-range-thumb]:size-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-track]:h-[3px] [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-[3.5px] [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          style={{
            backgroundImage: `linear-gradient(to right, #fff 0%, #fff ${percentage}%, rgba(255,255,255,0.4) ${percentage}%, rgba(255,255,255,0.4) ${watchedPercentage}%, rgba(255,255,255,0.12) ${watchedPercentage}%, rgba(255,255,255,0.12) 100%)`,
          }}
        />
        <button
          type="button"
          aria-label={`${copy.speedLabel}: ${currentRate}×`}
          aria-describedby={disabled && description ? hintId : undefined}
          title={[copy.speedLabel, hint].filter(Boolean).join(". ")}
          disabled={disabled}
          onClick={() => {
            if (!disabled) onRate(nextRate);
          }}
          className={classNames(
            CONTROL,
            "w-12 shrink-0 cursor-pointer px-2 text-sm tabular-nums sm:w-16 sm:px-3"
          )}
        >
          {currentRate}×
        </button>
        {trailingControls}
      </div>
      {description ? (
        <p id={hintId} className="sr-only">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function nonnegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function formatTime(valueMs: number): string {
  const totalSeconds = Math.floor(valueMs / 1_000);
  const seconds = `${totalSeconds % 60}`.padStart(2, "0");
  const minutes = Math.floor(totalSeconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${`${minutes % 60}`.padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
