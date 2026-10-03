// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ExperienceWorldModelRendererProps } from "@repo/experience-player-react";
import type {
  WorldTravelControllerOptions,
  WorldTravelControllerSnapshot,
} from "@/lib/world-model/world-travel-controller";
import { WorldModelExperienceRenderer } from "./world-model-experience-renderer";

/**
 * The world stream's part in a pause. The travel controller is stood in for —
 * it owns a provider session this test has no business opening — so what is
 * asserted is the renderer's side: which element it hands the player, when it
 * asks the stream to hold, and what it does with the answers.
 */

interface TravelDouble {
  options: WorldTravelControllerOptions;
  start: Mock<() => Promise<void>>;
  pause: Mock<() => Promise<void>>;
  resume: Mock<() => Promise<void>>;
  move: Mock<(command: unknown) => Promise<void>>;
  end: Mock<() => Promise<void>>;
}

const travel = vi.hoisted(() => ({ current: null as TravelDouble | null }));

vi.mock("@/lib/world-model/world-travel-controller", () => ({
  WorldTravelController: class {
    readonly options: WorldTravelControllerOptions;
    readonly start = vi.fn(() => Promise.resolve());
    readonly pause = vi.fn(() => Promise.resolve());
    readonly resume = vi.fn(() => Promise.resolve());
    readonly move = vi.fn(() => Promise.resolve());
    readonly instruct = vi.fn(() => Promise.resolve());
    readonly end = vi.fn(() => Promise.resolve());
    readonly dispose = vi.fn(() => Promise.resolve());
    constructor(options: WorldTravelControllerOptions) {
      this.options = options;
      travel.current = this as unknown as TravelDouble;
    }
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// The first frame is the stream's backdrop; nothing here turns on it.
vi.mock("next/image", () => ({ default: () => null }));

const config = {
  projectId: "0197f4a2-0800-7000-8000-000000000001",
  worldId: "0197f4a2-0800-7000-8000-000000000002",
  maxExperienceSeconds: 90,
  autoplay: true,
} as ExperienceWorldModelRendererProps["config"];

describe("WorldModelExperienceRenderer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onError: Mock<(error: unknown) => void>;
  let onMediaElement: Mock<(element: HTMLVideoElement | null) => void>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    travel.current = null;
    onError = vi.fn();
    onMediaElement = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const render = async (paused: boolean) => {
    await act(async () => {
      root.render(
        <WorldModelExperienceRenderer
          config={config}
          active
          paused={paused}
          onCompleted={() => {}}
          onError={onError}
          onMediaElement={onMediaElement}
        />
      );
    });
  };

  /** The stream moving to `phase`, as the controller reports it. */
  const reach = async (phase: WorldTravelControllerSnapshot["phase"]) => {
    await act(async () => {
      travel.current!.options.onChange?.({
        phase,
        streamStatus: phase === "running" ? "PLAYING" : "PAUSED",
        travelId: "travel-1",
        firstFrameUrl: null,
        error: null,
      });
    });
  };

  const key = async (value: string) => {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: value, cancelable: true }));
    });
  };

  it("hands the player the element its stream plays on, and takes it back as it goes", async () => {
    await render(false);
    const element = container.querySelector("video");
    expect(element).not.toBeNull();
    expect(onMediaElement).toHaveBeenLastCalledWith(element);
    expect(travel.current!.options.videoElement).toBe(element);

    await act(async () => {
      root.render(<></>);
    });

    expect(onMediaElement).toHaveBeenLastCalledWith(null);
  });

  it("holds the stream while the story is held, and lets it go with the story", async () => {
    await render(false);
    await reach("running");
    expect(travel.current!.pause).not.toHaveBeenCalled();

    await render(true);
    expect(travel.current!.pause).toHaveBeenCalledOnce();
    await reach("paused");
    expect(travel.current!.resume).not.toHaveBeenCalled();

    await render(false);
    expect(travel.current!.resume).toHaveBeenCalledOnce();
  });

  it("keeps a hold that fails away from the failure dialog: the stream only runs on", async () => {
    await render(false);
    await reach("running");
    travel.current!.pause.mockRejectedValueOnce(new Error("Travel cannot pause right now."));

    await render(true);

    expect(travel.current!.pause).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("says, as the provider does, that a release failed, rather than leave the stream stopped", async () => {
    await render(false);
    await reach("running");
    await render(true);
    await reach("paused");
    const refused = new Error("Travel cannot resume right now.");
    travel.current!.resume.mockRejectedValueOnce(refused);

    await render(false);

    expect(travel.current!.resume).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledExactlyOnceWith(refused);
  });

  it("takes no movement keys while the story is paused", async () => {
    await render(true);
    await reach("running");
    await key("w");
    expect(travel.current!.move).not.toHaveBeenCalled();

    await render(false);
    await key("w");
    expect(travel.current!.move).toHaveBeenCalledExactlyOnceWith({ movement: "forward" });
  });

  it("takes no movement keys until the stream runs again after the story resumes", async () => {
    await render(false);
    await reach("running");
    await render(true);
    await reach("paused");

    // The story runs again; the stream's resume is still on its way.
    await render(false);
    expect(travel.current!.resume).toHaveBeenCalledOnce();
    await key("w");
    expect(travel.current!.move).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    await reach("running");
    await key("w");
    expect(travel.current!.move).toHaveBeenCalledExactlyOnceWith({ movement: "forward" });
  });

  it("leaves pausing to the player's own toggle, and keeps Finish", async () => {
    await render(false);
    await reach("running");

    const labels = [...container.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label")
    );
    expect(labels).toContain("finish");
    expect(labels).not.toContain("pause");
    expect(labels).not.toContain("resume");
  });
});
