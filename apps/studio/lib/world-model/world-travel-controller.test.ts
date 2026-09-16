import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateWorldTravelRuntimeInput, WorldTravelRuntime } from "./world-travel-runtime";

const api = vi.hoisted(() => ({
  bindWorldTravel: vi.fn(),
  closeWorldSession: vi.fn(),
  createWorldSession: vi.fn(),
  heartbeatWorldSession: vi.fn(),
  refreshWorldSessionToken: vi.fn(),
  reportWorldTravelStatus: vi.fn(),
}));

vi.mock("@/lib/world-model-api", () => api);

import { WorldTravelController } from "./world-travel-controller";

const PROJECT_ID = "019ffc80-22af-704c-8403-cf77c5334696";
const WORLD_ID = "019ffc80-22af-704c-8403-cf77c5334697";
const SESSION_ID = "019ffc80-22af-704c-8403-cf77c5334698";
const TRAVEL_ID = "019ffc80-22af-704c-8403-cf77c5334699";

function createRuntimeHarness() {
  let input: CreateWorldTravelRuntimeInput | null = null;
  const runtime: WorldTravelRuntime = {
    can: vi.fn(() => true),
    start: vi.fn(async () => ({
      providerTravelId: "encrypted-travel",
      firstFrameUrl: "https://media.example/frame.jpg",
      maxExperienceSeconds: 90 as const,
    })),
    move: vi.fn(async () => undefined),
    instruct: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    rewind: vi.fn(async () => ({ resumedAtSeconds: 4 })),
    updateToken: vi.fn(),
    end: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const factory = vi.fn(async (nextInput: CreateWorldTravelRuntimeInput) => {
    input = nextInput;
    return runtime;
  });
  return {
    factory,
    runtime,
    events: () => {
      if (!input) throw new Error("The runtime was not created.");
      return input.events;
    },
  };
}

function createController(harness: ReturnType<typeof createRuntimeHarness>) {
  return new WorldTravelController({
    projectId: PROJECT_ID,
    worldId: WORLD_ID,
    videoElement: {} as HTMLVideoElement,
    maxExperienceSeconds: 90,
    runtimeFactory: harness.factory,
  });
}

describe("WorldTravelController", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    api.createWorldSession.mockResolvedValue({
      id: SESSION_ID,
      worldId: WORLD_ID,
      providerKey: "fal:happy-oyster",
      heartbeatIntervalSeconds: 30,
      sessionTimeoutSeconds: 120,
      maxExperienceSeconds: 90,
      connection: {
        apiBaseUrl: "https://world.example/api",
        ticket: "ticket",
        token: "token",
        tokenExpiresIn: 60,
      },
    });
    api.bindWorldTravel.mockResolvedValue({
      id: TRAVEL_ID,
      sessionId: SESSION_ID,
      worldId: WORLD_ID,
      status: "running",
    });
    api.closeWorldSession.mockResolvedValue({ closed: true });
    api.reportWorldTravelStatus.mockResolvedValue({
      id: TRAVEL_ID,
      worldId: WORLD_ID,
      status: "running",
      rtcStatus: "PLAYING",
      updatedAt: null,
    });
  });

  it("creates, starts, and binds one runtime through an idempotent start", async () => {
    const harness = createRuntimeHarness();
    const controller = createController(harness);

    const firstStart = controller.start();
    const secondStart = controller.start();
    expect(secondStart).toBe(firstStart);
    await firstStart;

    expect(api.createWorldSession).toHaveBeenCalledOnce();
    expect(harness.factory).toHaveBeenCalledOnce();
    expect(harness.runtime.start).toHaveBeenCalledOnce();
    expect(api.bindWorldTravel).toHaveBeenCalledWith(PROJECT_ID, SESSION_ID, {
      providerTravelId: "encrypted-travel",
    });
    expect(controller.state).toMatchObject({ phase: "running", travelId: TRAVEL_ID });

    await controller.dispose();
  });

  it("marks a naturally completed provider travel as completed when closing", async () => {
    const harness = createRuntimeHarness();
    const controller = createController(harness);
    await controller.start();

    harness.events()?.onCompleted?.();

    await vi.waitFor(() => expect(controller.state.phase).toBe("ended"));
    expect(api.closeWorldSession).toHaveBeenCalledWith(PROJECT_ID, SESSION_ID, {
      travelCompleted: true,
    });
  });

  it("does not claim completion when the user ends the travel", async () => {
    const harness = createRuntimeHarness();
    const controller = createController(harness);
    await controller.start();

    await controller.end();

    expect(controller.state.phase).toBe("ended");
    expect(api.closeWorldSession).toHaveBeenCalledWith(PROJECT_ID, SESSION_ID, {
      travelCompleted: false,
    });
  });

  it("retains failed cleanup resources so ending can be retried", async () => {
    const harness = createRuntimeHarness();
    const controller = createController(harness);
    await controller.start();
    api.closeWorldSession.mockRejectedValueOnce(new Error("close failed"));

    await expect(controller.end()).rejects.toThrow("close failed");
    expect(controller.state.phase).toBe("failed");

    await controller.end();

    expect(api.closeWorldSession).toHaveBeenCalledTimes(2);
    expect(harness.runtime.dispose).toHaveBeenCalledOnce();
    expect(controller.state.phase).toBe("failed");
  });

  it("preserves the failed state while releasing a provider runtime error", async () => {
    const harness = createRuntimeHarness();
    const controller = createController(harness);
    await controller.start();
    const error = new Error("provider connection failed");

    harness.events()?.onError?.(error);

    await vi.waitFor(() => expect(api.closeWorldSession).toHaveBeenCalledOnce());
    expect(controller.state).toMatchObject({ phase: "failed", error });
    expect(api.closeWorldSession).toHaveBeenCalledWith(PROJECT_ID, SESSION_ID, {
      travelCompleted: false,
    });
  });

  it("delegates product controls without exposing provider command names", async () => {
    const harness = createRuntimeHarness();
    const controller = createController(harness);
    await controller.start();

    await controller.move({ movement: "forward-left", interaction: "sprint" });
    await controller.instruct("Open the gate");
    expect(() => controller.rewind(4)).toThrow("must be paused");
    await controller.pause();
    await controller.rewind(4);
    await controller.resume();

    expect(harness.runtime.move).toHaveBeenCalledWith({
      movement: "forward-left",
      interaction: "sprint",
    });
    expect(harness.runtime.instruct).toHaveBeenCalledWith("Open the gate");
    expect(harness.runtime.pause).toHaveBeenCalledOnce();
    expect(harness.runtime.rewind).toHaveBeenCalledWith(4);
    expect(harness.runtime.resume).toHaveBeenCalledOnce();

    await controller.dispose();
  });
  it.each(["pause", "resume"] as const)(
    "does not revive an ended session after delayed %s",
    async (action) => {
      const harness = createRuntimeHarness();
      const controller = createController(harness);
      await controller.start();
      if (action === "resume") await controller.pause();
      let finish!: () => void;
      vi.mocked(harness.runtime[action]).mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            finish = r;
          })
      );
      const pending = controller[action]();
      await controller.end();
      finish();
      await pending;
      expect(controller.state.phase).toBe("ended");
    }
  );
  it("ignores provider events after ending", async () => {
    const harness = createRuntimeHarness();
    const controller = createController(harness);
    await controller.start();
    await controller.end();
    const ended = controller.state;
    harness.events()?.onStatusChange?.("PLAYING");
    harness.events()?.onFirstFrame?.("late.jpg");
    harness.events()?.onError?.(new Error("late"));
    expect(controller.state).toEqual(ended);
    expect(api.reportWorldTravelStatus).not.toHaveBeenCalled();
  });
  it.each(["heartbeat", "token"])("ignores delayed %s failure after ending", async (kind) => {
    vi.useFakeTimers();
    let reject!: (e: Error) => void;
    const request = kind === "heartbeat" ? api.heartbeatWorldSession : api.refreshWorldSessionToken;
    request.mockImplementationOnce(
      () =>
        new Promise((_r, j) => {
          reject = j;
        })
    );
    if (kind === "token")
      api.heartbeatWorldSession.mockResolvedValue({ alive: true, heartbeatIntervalSeconds: 30 });
    const harness = createRuntimeHarness();
    const controller = createController(harness);
    await controller.start();
    await vi.advanceTimersByTimeAsync(kind === "heartbeat" ? 30_000 : 45_000);
    await controller.end();
    reject(new Error("late network error"));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.state.phase).toBe("ended");
    expect(vi.getTimerCount()).toBe(0);
  });
});
