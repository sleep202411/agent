"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type Ref,
} from "react";
import { EXPERIENCE_RENDERER_MAX_LAYER } from "@repo/shared/experience-runtime";
import { IconPlayerPauseFilled, IconPlayerPlayFilled, IconVolumeOff } from "@tabler/icons-react";
import { classNames } from "./class-names";
import type { ExperiencePlayerCopy, ExperiencePlayerPlaybackCopy } from "./experience-player-copy";
import type { ExperienceViewerPauseReason } from "./experience-playback-holds";
import { PRIMARY_BUTTON } from "./experience-player-styles";

/** The frame's glass controls: a frosted body that reads over any footage, under a rim light. */
const FROSTED_CONTROL =
  "pointer-events-auto relative bg-black/45 text-white/90 outline-none backdrop-blur-md backdrop-saturate-150 transition-colors hover:bg-black/60 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 motion-reduce:transition-none";

/** How far the cluster drops to clear the host's chrome: what that chrome leaves of the band above the picture. */
const CLUSTER_TOP =
  "max(0px, calc(var(--experience-chrome-inset-top, 0px) + var(--experience-player-corner-height, 0px) - var(--experience-frame-inset-top, 0px)))";

/**
 * A pointer press on the frame's controls leaves focus where it was — on the
 * story, a text scene's article say — so a pause made with one still finds it
 * there to give back on resume. Keyboard focus reaches them as ever.
 */
function keepFocus(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

/**
 * The film frame's own controls, at its top-right. Over a world stream —
 * which takes the picture's taps and Space for its own moves — the pause
 * toggle stands here, the one place it can. Elsewhere a missed tap on the
 * picture pauses and Space pauses, so the frame keeps no toggle of its own,
 * and what remains is the unmute pill under the corner when sound was
 * refused. A column, right-aligned, so whatever shows keeps to the frame's
 * right edge, out of whatever host chrome sits further left. The bottom band
 * belongs to the choices, and the top-left meets the host's menus.
 *
 * They sit in the frame, so they turn with it when it is drawn sideways — on an
 * upright phone the frame's top-right is the screen's bottom-right, under the
 * right thumb — and stay inside the player in fullscreen. They stack above the
 * widest renderer band a manifest may declare, as a raw z-index like the
 * renderers' own layers: a Tailwind `z-*` would sit under a choice overlay.
 *
 * Host chrome along the top of the screen is kept clear by a small contract.
 * The host sets `--experience-chrome-inset-top`, how far down its chrome
 * reaches; the frame sets `--experience-frame-inset-top`, the band above the
 * picture; the cluster drops by what the first leaves of the second.
 */
export function ExperienceFrameControls({
  toggleRef,
  copy,
  paused,
  worldStream,
  unmuteVisible,
  keyShortcut,
  onToggle,
  onUnmute,
}: {
  toggleRef?: Ref<HTMLButtonElement>;
  copy: ExperiencePlayerCopy;
  /** The viewer has the story paused. */
  paused: boolean;
  /** A world stream keeps its taps and Space: its pause stands in the corner. */
  worldStream: boolean;
  /** The browser refused sound, so the clip plays muted until the viewer turns it on. */
  unmuteVisible: boolean;
  /** Space toggles the film as well. */
  keyShortcut: boolean;
  onToggle: () => void;
  onUnmute: () => void;
}) {
  const clusterRef = useRef<HTMLDivElement>(null);
  // An interaction the film offers right here wins the corner: the controls
  // step aside while it is open — Space still pauses — and come back over the
  // paused frame, where nothing under them can be hit. Checked off the boxes on
  // screen after every commit, so it holds however the frame is turned or
  // inset; a gesture's control marks itself while it is available (see the
  // spatial layer), and most commits find none and measure nothing.
  useLayoutEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;
    cluster.toggleAttribute(
      "data-experience-gesture-covered",
      !paused && coveredByAvailableGesture(cluster)
    );
  });
  const label = paused ? copy.playback.resume : copy.playback.pause;
  return (
    <>
      <div
        ref={clusterRef}
        data-experience-frame-controls=""
        className="pointer-events-none absolute right-0 flex flex-col items-end gap-[clamp(6px,1.2cqmin,12px)] p-[clamp(10px,2.4cqmin,24px)] data-[experience-gesture-covered]:invisible"
        style={{ top: CLUSTER_TOP, zIndex: EXPERIENCE_RENDERER_MAX_LAYER + 2 }}
      >
        {worldStream ? (
          <button
            ref={toggleRef}
            type="button"
            className={classNames(
              FROSTED_CONTROL,
              "grid size-11 place-items-center rounded-full active:scale-[0.96]"
            )}
            aria-label={label}
            title={label}
            aria-keyshortcuts={keyShortcut ? "Space" : undefined}
            onMouseDown={keepFocus}
            onClick={onToggle}
          >
            <GlassRim />
            {paused ? (
              <IconPlayerPlayFilled className="size-5" aria-hidden="true" />
            ) : (
              <IconPlayerPauseFilled className="size-5" aria-hidden="true" />
            )}
          </button>
        ) : null}
        {unmuteVisible ? (
          <button
            type="button"
            className={classNames(
              FROSTED_CONTROL,
              "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold active:scale-[0.98]"
            )}
            onMouseDown={keepFocus}
            onClick={onUnmute}
          >
            <GlassRim />
            <IconVolumeOff className="size-4" aria-hidden="true" />
            {copy.video.unmute}
          </button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {paused ? copy.playback.paused : null}
      </p>
    </>
  );
}

/**
 * The paused frame: one button the size of the picture, so a tap anywhere on
 * it resumes — the story under it is inert, so no hotspot can be hit by
 * mistake. It is not blurred: blur already says "locked" on the access gate.
 *
 * After a refusal it asks for that tap outright, with the one accent on screen,
 * and says why. The browser's own words go to the debug trace: a refusal is a
 * state to recover from with a tap, not a failure to report.
 */
export function ExperiencePausedScrim({
  ref,
  copy,
  reason,
  onResume,
}: {
  ref?: Ref<HTMLButtonElement>;
  copy: ExperiencePlayerPlaybackCopy;
  reason: ExperienceViewerPauseReason;
  onResume: () => void;
}) {
  const hintId = useId();
  const refused = reason === "refused";
  return (
    <button
      ref={ref}
      type="button"
      data-experience-paused-frame={reason}
      aria-label={refused ? copy.continuePlaying : copy.resume}
      aria-describedby={refused ? hintId : undefined}
      className={classNames(
        "group absolute inset-0 grid place-items-center outline-none transition-opacity duration-150 starting:opacity-0 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-inset motion-reduce:transition-none",
        refused ? "bg-black/60" : "bg-black/40"
      )}
      style={{ zIndex: EXPERIENCE_RENDERER_MAX_LAYER + 1 }}
      onClick={onResume}
    >
      {refused ? (
        <span className="flex max-w-[86cqw] flex-col items-center px-6 text-center">
          <span className={classNames(PRIMARY_BUTTON, "group-hover:brightness-110")}>
            <IconPlayerPlayFilled className="size-4" aria-hidden="true" />
            {copy.continuePlaying}
          </span>
          <span
            id={hintId}
            className="mt-3 text-[length:clamp(11px,2cqmin,14px)] leading-[1.45] text-white/60"
          >
            {copy.interrupted}
          </span>
        </span>
      ) : (
        <span className="relative grid size-[clamp(56px,14cqmin,88px)] place-items-center rounded-full bg-black/45 text-white/90 backdrop-blur-md backdrop-saturate-150 transition-colors group-hover:bg-black/60 group-hover:text-white motion-reduce:transition-none">
          <GlassRim />
          <IconPlayerPlayFilled className="size-[42%] translate-x-[4%]" aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

/**
 * The rim light of the frame's glass: a soft gradient hairline masked to the
 * very edge, so it catches light on the border instead of drawing a hard line —
 * the edge the Studio's glass surfaces carry. The film frame keeps its own copy
 * so it looks the same in every host.
 */
function GlassRim() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit]"
      style={GLASS_RIM}
    />
  );
}

const GLASS_RIM: CSSProperties = {
  background:
    "conic-gradient(from 288deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 42%, rgba(255,255,255,0) 43%, rgba(255,255,255,0.06) 48%, rgba(255,255,255,0) 88%, rgba(255,255,255,0) 90%, rgba(255,255,255,0.16) 100%)",
  padding: "1px",
  WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
  WebkitMaskComposite: "xor",
  maskComposite: "exclude",
};

/** How far a tap that missed everything still counts as aimed at a gesture. */
const GESTURE_TAP_MARGIN_PX = 24;

/**
 * Whether a tap that hit no control was still aimed at a gesture the film
 * offers on the picture right now: within a finger's width of its box, as the
 * boxes stand on screen after any turn of the frame. The boxes are read, not
 * the authored geometry, so it holds however the frame is drawn.
 */
export function nearAvailableExperienceGesture(stage: Element, x: number, y: number): boolean {
  for (const gesture of stage.querySelectorAll("[data-experience-gesture-available]")) {
    const area = gesture.getBoundingClientRect();
    if (
      x >= area.left - GESTURE_TAP_MARGIN_PX &&
      x <= area.right + GESTURE_TAP_MARGIN_PX &&
      y >= area.top - GESTURE_TAP_MARGIN_PX &&
      y <= area.bottom + GESTURE_TAP_MARGIN_PX
    ) {
      return true;
    }
  }
  return false;
}

/** Whether an interaction the film offers right now lies under one of the cluster's controls. */
function coveredByAvailableGesture(cluster: HTMLElement): boolean {
  const gestures = cluster
    .closest("[data-experience-media-stage]")
    ?.querySelectorAll("[data-experience-gesture-available]");
  if (!gestures?.length) return false;
  const controls = [...cluster.querySelectorAll("button")].map((control) =>
    control.getBoundingClientRect()
  );
  return [...gestures].some((gesture) => {
    const area = gesture.getBoundingClientRect();
    return controls.some((control) => overlaps(control, area));
  });
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
