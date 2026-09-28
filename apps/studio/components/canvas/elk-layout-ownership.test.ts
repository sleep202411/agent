import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./browser-elk-layout-client", () => ({ createBrowserElkLayoutEngine: mocks.create }));
beforeEach(() => {
  vi.resetModules();
  mocks.create.mockReset();
  vi.stubGlobal("window", {});
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const empty = {
  nodes: [],
  edges: [],
  lanes: [],
  direction: "RIGHT" as const,
  nodeSpacing: 80,
  layerSpacing: 120,
  componentSpacing: 180,
  componentAspectRatio: 16 / 9,
};
const request = {
  ...empty,
  nodes: ["one", "two"].map((id) => ({ id, width: 100, height: 100, position: { x: 0, y: 0 } })),
  edges: [{ id: "edge", source: "one", target: "two" }],
};

it.each(["rejection", "timeout"])(
  "a late old-worker %s does not terminate its replacement",
  async (failure) => {
    let rejectFirst!: (reason: Error) => void;
    let rejectSecond!: (reason: Error) => void;
    const old = {
      layout: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectFirst = reject;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectSecond = reject;
            })
        ),
      terminateWorker: vi.fn(),
    };
    const replacement = { layout: vi.fn(), terminateWorker: vi.fn() };
    mocks.create.mockReturnValueOnce(old).mockReturnValue(replacement);
    const { layoutCanvasTidyGraph } = await import("./elk-canvas-layout-engine");
    const first = layoutCanvasTidyGraph(request).catch((error: unknown) => error);
    const second = layoutCanvasTidyGraph(request).catch((error: unknown) => error);
    await vi.waitFor(() => expect(old.layout).toHaveBeenCalledTimes(2));
    const firstError = new Error("first layout failed");
    rejectFirst(firstError);
    expect(await first).toBe(firstError);
    await expect(layoutCanvasTidyGraph(empty)).resolves.toEqual([]);
    expect(old.terminateWorker).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    if (failure === "rejection") rejectSecond(new Error("late failure"));
    else await vi.advanceTimersByTimeAsync(15_000);
    expect(await second).toBeInstanceOf(Error);
    expect(replacement.terminateWorker).not.toHaveBeenCalled();
    await expect(layoutCanvasTidyGraph(empty)).resolves.toEqual([]);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(old.terminateWorker).toHaveBeenCalledOnce();
  }
);
