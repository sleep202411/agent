"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconPlayerStop,
} from "@tabler/icons-react";
import type { ExperienceWorldModelRendererProps } from "@repo/experience-player-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  WorldTravelController,
  type WorldTravelControllerSnapshot,
} from "@/lib/world-model/world-travel-controller";

const INITIAL_SNAPSHOT: WorldTravelControllerSnapshot = {
  phase: "idle",
  streamStatus: "DISCONNECTED",
  travelId: null,
  firstFrameUrl: null,
  error: null,
};

const CONTROL_BUTTON =
  "grid size-11 place-items-center rounded-xl border border-white/12 bg-black/52 text-white/88 backdrop-blur-md transition-colors hover:bg-white/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none";

export function WorldModelExperienceRenderer({
  config,
  active,
  paused,
  onCompleted,
  onError,
  onMediaElement,
}: ExperienceWorldModelRendererProps) {
  const t = useTranslations("experiencePlayer.world");
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<WorldTravelController | null>(null);
  const completedRef = useRef(false);
  const instructionSentRef = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  const onErrorRef = useRef(onError);
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);

  const runControllerAction = useCallback(async (action: () => Promise<unknown> | undefined) => {
    try {
      await action();
    } catch (error) {
      onErrorRef.current(error);
    }
  }, []);

  useEffect(() => {
    onCompletedRef.current = onCompleted;
    onErrorRef.current = onError;
  }, [onCompleted, onError]);

  // The player plays the stream's element inside the viewer's taps — the only
  // play WebKit allows it under Low Power Mode — and holds it with the story.
  useEffect(() => {
    onMediaElement(videoRef.current);
    return () => onMediaElement(null);
  }, [onMediaElement]);

  useEffect(() => {
    if (!active || !videoRef.current || controllerRef.current) return;
    const controller = new WorldTravelController({
      projectId: config.projectId,
      worldId: config.worldId,
      videoElement: videoRef.current,
      maxExperienceSeconds: config.maxExperienceSeconds,
      onChange: setSnapshot,
    });
    controllerRef.current = controller;
    void controller.start().catch((error) => onErrorRef.current(error));

    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      void controller.dispose().catch(() => undefined);
    };
  }, [active, config.maxExperienceSeconds, config.projectId, config.worldId]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (
      !controller ||
      snapshot.phase !== "running" ||
      instructionSentRef.current ||
      !config.entryInstruction
    ) {
      return;
    }
    instructionSentRef.current = true;
    void controller.instruct(config.entryInstruction).catch((error) => onErrorRef.current(error));
  }, [config.entryInstruction, snapshot.phase]);

  useEffect(() => {
    if (snapshot.phase === "failed" && snapshot.error) onErrorRef.current(snapshot.error);
    if (snapshot.phase !== "ended" || completedRef.current) return;
    completedRef.current = true;
    onCompletedRef.current();
  }, [snapshot.error, snapshot.phase]);

  // The stream holds with the story: the viewer's pause, a page put away, an
  // access flow. These calls are the player's, not the viewer's, so a failed
  // one never raises the failure dialog: the stream stays where it was, and the
  // viewer's next pause and resume asks again. A stream that has really failed
  // says so through its own snapshot, above.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (paused && snapshot.phase === "running") void controller.pause().catch(() => undefined);
    else if (!paused && snapshot.phase === "paused") {
      void controller.resume().catch(() => undefined);
    }
  }, [paused, snapshot.phase]);

  // Movement keys are the story's input, which holds while it is paused.
  useEffect(() => {
    if (!active || paused) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const movement =
        event.key === "w" || event.key === "W" || event.key === "ArrowUp"
          ? "forward"
          : event.key === "s" || event.key === "S" || event.key === "ArrowDown"
            ? "backward"
            : event.key === "a" || event.key === "A" || event.key === "ArrowLeft"
              ? "left"
              : event.key === "d" || event.key === "D" || event.key === "ArrowRight"
                ? "right"
                : null;
      if (movement) {
        event.preventDefault();
        void runControllerAction(() => controllerRef.current?.move({ movement }));
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        void runControllerAction(() => controllerRef.current?.move({ interaction: "jump" }));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, paused, runControllerAction]);

  const running = snapshot.phase === "running";
  const streamPaused = snapshot.phase === "paused";
  const loading = snapshot.phase === "idle" || snapshot.phase === "starting";

  return (
    <section className="relative size-full bg-black" aria-label={t("label")}>
      {snapshot.firstFrameUrl ? (
        <Image
          src={snapshot.firstFrameUrl}
          alt=""
          aria-hidden="true"
          fill
          unoptimized
          sizes="100vw"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="absolute inset-0 size-full object-cover"
        aria-label={t("stream")}
      />

      {loading ? (
        <div className="absolute inset-0 grid place-items-center bg-black/48 text-center backdrop-blur-sm">
          <div>
            <div className="mx-auto size-6 animate-spin rounded-full border-2 border-white/20 border-t-white motion-reduce:animate-none" />
            <p className="mt-3 text-sm font-semibold text-white/82">{t("connecting")}</p>
          </div>
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 bg-gradient-to-t from-black/72 via-black/20 to-transparent p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-7">
        <div className="grid grid-cols-3 gap-1.5" aria-label={t("movementControls")}>
          <span />
          <ControlButton
            label={t("forward")}
            disabled={!running}
            onClick={() =>
              void runControllerAction(() => controllerRef.current?.move({ movement: "forward" }))
            }
          >
            <IconArrowUp className="size-5" />
          </ControlButton>
          <span />
          <ControlButton
            label={t("left")}
            disabled={!running}
            onClick={() =>
              void runControllerAction(() => controllerRef.current?.move({ movement: "left" }))
            }
          >
            <IconArrowLeft className="size-5" />
          </ControlButton>
          <ControlButton
            label={t("backward")}
            disabled={!running}
            onClick={() =>
              void runControllerAction(() => controllerRef.current?.move({ movement: "backward" }))
            }
          >
            <IconArrowDown className="size-5" />
          </ControlButton>
          <ControlButton
            label={t("right")}
            disabled={!running}
            onClick={() =>
              void runControllerAction(() => controllerRef.current?.move({ movement: "right" }))
            }
          >
            <IconArrowRight className="size-5" />
          </ControlButton>
        </div>

        {/* Pausing belongs to the player's own toggle, which pauses the story
            and the stream with it. */}
        <ControlButton
          label={t("finish")}
          disabled={!running && !streamPaused}
          onClick={() => void runControllerAction(() => controllerRef.current?.end())}
        >
          <IconPlayerStop className="size-5" />
        </ControlButton>
      </div>
    </section>
  );
}

function ControlButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={CONTROL_BUTTON}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
