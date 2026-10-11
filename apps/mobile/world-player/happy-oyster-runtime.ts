import {
  FAL_HAPPY_OYSTER_PROVIDER_KEY,
  type WorldStreamStatus,
} from "@repo/shared/world-model-protocol";
import type { Travel, TravelAction, TravelStatus } from "@happy-oyster/js-sdk";
import type {
  CreateWorldTravelRuntimeInput,
  WorldInteractionAction,
  WorldLookDirection,
  WorldMovementDirection,
  WorldTravelAction,
  WorldTravelRuntime,
} from "../src/features/experience-player/world/world-travel-runtime";

const SDK_ACTIONS: Record<WorldTravelAction, TravelAction> = {
  start: "start",
  move: "sendCommand",
  instruct: "sendInstruct",
  pause: "pause",
  resume: "resume",
  rewind: "rewind",
  end: "end",
};

const MOVEMENTS: Record<WorldMovementDirection, string> = {
  none: "None",
  forward: "Front",
  backward: "Back",
  left: "Left",
  right: "Right",
  "forward-left": "Front_Left",
  "forward-right": "Front_Right",
  "backward-left": "Back_Left",
  "backward-right": "Back_Right",
};

const LOOK_DIRECTIONS: Record<WorldLookDirection, string> = {
  none: "None",
  up: "Mouse_Up",
  down: "Mouse_Down",
  left: "Mouse_Left",
  right: "Mouse_Right",
  "up-left": "Mouse_Up_Left",
  "up-right": "Mouse_Up_Right",
  "down-left": "Mouse_Down_Left",
  "down-right": "Mouse_Down_Right",
};

const INTERACTIONS: Record<WorldInteractionAction, string> = {
  none: "None",
  jump: "Jump",
  attack: "Attack",
  crouch: "Crouch",
  sprint: "Sprint",
};

const STREAM_STATUS: Record<TravelStatus, WorldStreamStatus> = {
  idle: "DISCONNECTED",
  prepare: "CONNECTING",
  running: "PLAYING",
  paused: "PAUSED",
  completed: "DISCONNECTED",
};

function providerHost(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The world model API base URL must use HTTP or HTTPS.");
  }
  return url.host;
}

class HappyOysterTravelRuntime implements WorldTravelRuntime {
  private ended = false;
  private endPromise: Promise<void> | null = null;
  private readonly unsubscribe: (() => void)[];

  constructor(
    private readonly engine: { updateToken(token: string): void },
    private readonly travel: Travel,
    input: CreateWorldTravelRuntimeInput
  ) {
    this.unsubscribe = [
      travel.on("statusChanged", (status) => {
        input.events?.onStatusChange?.(STREAM_STATUS[status]);
        if (status === "completed" && !this.ended) input.events?.onCompleted?.();
      }),
      travel.on("firstFrameGenerated", (url) => input.events?.onFirstFrame?.(url)),
      travel.on("error", (error) => input.events?.onError?.(error)),
    ];
  }

  can(action: WorldTravelAction): boolean {
    return !this.ended && this.travel.can(SDK_ACTIONS[action]);
  }

  async start() {
    const result = await this.travel.start();
    return {
      providerTravelId: result.encryptedTravelId,
      firstFrameUrl: result.firstFrame,
      maxExperienceSeconds: result.maxExperienceTimeSec,
    };
  }

  move(command: Parameters<WorldTravelRuntime["move"]>[0]) {
    return this.travel.sendCommand({
      translation: MOVEMENTS[command.movement ?? "none"],
      rotation: LOOK_DIRECTIONS[command.look ?? "none"],
      interaction: INTERACTIONS[command.interaction ?? "none"],
    });
  }

  instruct(content: string) {
    return this.travel.sendInstruct({ content });
  }

  pause() {
    return this.travel.pause();
  }

  resume() {
    return this.travel.resume();
  }

  async rewind(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error("Rewind time must be a non-negative number.");
    }
    const rewindToSec = Math.floor(seconds / 4) * 4;
    const result = await this.travel.rewind({ rewindToSec });
    return { resumedAtSeconds: result.resumedAtSec };
  }

  updateToken(token: string) {
    this.engine.updateToken(token);
  }

  async end() {
    if (this.endPromise) return this.endPromise;
    if (this.ended) return;
    this.ended = true;
    // Share the in-flight result; failed cleanup must remain retryable.
    this.endPromise = Promise.resolve()
      .then(async () => {
        if (this.travel.can("end")) await this.travel.end();
      })
      .catch((error) => {
        this.ended = false;
        throw error;
      })
      .finally(() => {
        this.endPromise = null;
      });
    return this.endPromise;
  }

  async dispose() {
    try {
      await this.end();
    } finally {
      this.unsubscribe.splice(0).forEach((unsubscribe) => unsubscribe());
    }
  }
}

export async function createHappyOysterRuntime(
  input: CreateWorldTravelRuntimeInput,
  videoElement: HTMLVideoElement
): Promise<WorldTravelRuntime> {
  if (input.providerKey !== FAL_HAPPY_OYSTER_PROVIDER_KEY) {
    throw new Error(`Unsupported world model provider: ${input.providerKey}`);
  }
  const { HappyOysterEngine } = await import("@happy-oyster/js-sdk");
  const engine = new HappyOysterEngine({
    APIHost: providerHost(input.connection.apiBaseUrl),
    token: input.connection.token,
    logLevel: "error",
  });
  const travel = engine.createTravel({
    ticket: input.connection.ticket,
    videoElement,
    ...(input.maxExperienceSeconds ? { maxExperienceTimeSec: input.maxExperienceSeconds } : {}),
  });
  return new HappyOysterTravelRuntime(engine, travel, input);
}
