import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./browser-elk-layout-client", () => ({ createBrowserElkLayoutEngine: mocks.create }));
beforeEach(() => {
  vi.resetModules();
  mocks.create.mockReset();
  vi.stubGlobal("window", {});
});
afterEach(() => {
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
it("retries construction after an initial worker startup failure", async () => {
  const fail = new Error("Worker could not start");
  const engine = { layout: vi.fn(), terminateWorker: vi.fn() };
  mocks.create.mockRejectedValueOnce(fail).mockResolvedValueOnce(engine);
  const { layoutCanvasTidyGraph } = await import("./elk-canvas-layout-engine");
  await expect(layoutCanvasTidyGraph(empty)).rejects.toBe(fail);
  await expect(layoutCanvasTidyGraph(empty)).resolves.toEqual([]);
  expect(mocks.create).toHaveBeenCalledTimes(2);
});
it("shares a successfully initialized worker across requests", async () => {
  mocks.create.mockReturnValue({ layout: vi.fn(), terminateWorker: vi.fn() });
  const { layoutCanvasTidyGraph } = await import("./elk-canvas-layout-engine");
  await Promise.all([layoutCanvasTidyGraph(empty), layoutCanvasTidyGraph(empty)]);
  expect(mocks.create).toHaveBeenCalledOnce();
});
it("retries after a synchronous construction exception", async () => {
  mocks.create
    .mockImplementationOnce(() => {
      throw Error("CSP blocked worker");
    })
    .mockReturnValue({ layout: vi.fn() });
  const { layoutCanvasTidyGraph } = await import("./elk-canvas-layout-engine");
  await expect(layoutCanvasTidyGraph(empty)).rejects.toThrow("CSP blocked worker");
  await expect(layoutCanvasTidyGraph(empty)).resolves.toEqual([]);
});
