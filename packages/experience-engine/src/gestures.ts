import type { ExperienceGesture } from "@repo/shared/experience-runtime";
import {
  evaluateExperienceCondition,
  type ExperienceRuntimeEvent,
  type ExperienceRuntimeState,
} from "./runtime.js";

export type ExperiencePressHoldGesture = Extract<ExperienceGesture, { kind: "press-hold" }>;

export interface ExperiencePressHoldState {
  status: "idle" | "pressing" | "decaying" | "completed";
  progress: number;
  blockedUntilRelease: boolean;
}

export interface ExperiencePressHoldInput {
  pressed: boolean;
  pointerInside: boolean;
  deltaMs: number;
}

export type ExperiencePressHoldSignal = "started" | "cancelled" | "completed";

export interface ExperiencePressHoldStep {
  state: ExperiencePressHoldState;
  signals: ExperiencePressHoldSignal[];
}

export function createExperiencePressHoldState(): ExperiencePressHoldState {
  return { status: "idle", progress: 0, blockedUntilRelease: false };
}

export function isExperienceGestureAvailable(
  gesture: ExperienceGesture,
  state: ExperienceRuntimeState,
  sceneTimeMs: number,
  context: ExperienceRuntimeEvent = { type: "runtime.gesture-availability" }
): boolean {
  if (!Number.isFinite(sceneTimeMs) || sceneTimeMs < 0) {
    throw new RangeError("Gesture sceneTimeMs must be finite and non-negative");
  }
  if (
    gesture.activeWindow &&
    (sceneTimeMs < gesture.activeWindow.startMs || sceneTimeMs > gesture.activeWindow.endMs)
  ) {
    return false;
  }
  return gesture.enabledWhen
    ? evaluateExperienceCondition(gesture.enabledWhen, state, context)
    : true;
}

export function stepExperiencePressHoldInRuntime(
  gesture: ExperiencePressHoldGesture,
  current: ExperiencePressHoldState,
  input: ExperiencePressHoldInput,
  runtime: {
    state: ExperienceRuntimeState;
    sceneTimeMs: number;
    context?: ExperienceRuntimeEvent;
  }
): ExperiencePressHoldStep {
  assertPressHoldInput(input);
  if (isExperienceGestureAvailable(gesture, runtime.state, runtime.sceneTimeMs, runtime.context)) {
    return stepExperiencePressHold(gesture, current, input);
  }
  const wasActive = current.status === "pressing" || current.progress > 0;
  return {
    state: {
      status: "idle",
      progress: 0,
      blockedUntilRelease: input.pressed,
    },
    signals: wasActive ? ["cancelled"] : [],
  };
}

export function stepExperiencePressHold(
  gesture: ExperiencePressHoldGesture,
  current: ExperiencePressHoldState,
  input: ExperiencePressHoldInput
): ExperiencePressHoldStep {
  assertPressHoldInput(input);
  if (current.status === "completed") return { state: current, signals: [] };

  if (current.blockedUntilRelease) {
    if (input.pressed) return { state: current, signals: [] };
    return {
      state: { ...current, status: "idle", blockedUntilRelease: false },
      signals: [],
    };
  }

  const signals: ExperiencePressHoldSignal[] = [];
  const canCharge = input.pressed && (input.pointerInside || !gesture.cancelOnPointerExit);
  if (canCharge) {
    if (current.status !== "pressing") signals.push("started");
    const progress = Math.min(1, current.progress + input.deltaMs / gesture.durationMs);
    if (progress >= 1) signals.push("completed");
    return {
      state: {
        status: progress >= 1 ? "completed" : "pressing",
        progress,
        blockedUntilRelease: false,
      },
      signals,
    };
  }

  if (current.status === "pressing") signals.push("cancelled");
  if (gesture.releaseBehavior === "reset") {
    return {
      state: {
        status: "idle",
        progress: 0,
        blockedUntilRelease: input.pressed && gesture.cancelOnPointerExit,
      },
      signals,
    };
  }
  if (gesture.releaseBehavior === "retain") {
    return {
      state: {
        status: "idle",
        progress: current.progress,
        blockedUntilRelease: input.pressed && gesture.cancelOnPointerExit,
      },
      signals,
    };
  }

  const decayPerSecond = gesture.decayPerSecond;
  if (decayPerSecond === undefined) {
    throw new Error(`Decay gesture ${gesture.gestureId} has no decayPerSecond`);
  }
  const progress = Math.max(0, current.progress - decayPerSecond * (input.deltaMs / 1_000));
  return {
    state: {
      status: progress > 0 ? "decaying" : "idle",
      progress,
      blockedUntilRelease: input.pressed && gesture.cancelOnPointerExit,
    },
    signals,
  };
}

function assertPressHoldInput(input: ExperiencePressHoldInput): void {
  if (!Number.isFinite(input.deltaMs) || input.deltaMs < 0) {
    throw new RangeError("Gesture deltaMs must be finite and non-negative");
  }
}
