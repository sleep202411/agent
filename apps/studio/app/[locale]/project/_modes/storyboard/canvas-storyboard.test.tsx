import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStoryboard } from "./canvas-storyboard";
const mocks = vi.hoisted(() => ({
  attach: vi.fn(() => true),
  select: vi.fn(),
  move: vi.fn(),
  canEdit: true,
  kind: "video",
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./storyboard-playback", () => ({ StoryboardPlayback: () => null }));
vi.mock("@/lib/canvas-core/canvas-graph-context", () => ({
  useCanvasGraphContext: () => ({
    nodes: [{ id: "video", selected: true }],
    selectNodes: mocks.select,
  }),
}));
vi.mock("./use-storyboard", () => ({
  useStoryboard: () => ({
    rows: [{ id: "shot", pictures: [] }],
    canvasSources: [{ nodeId: "video", kind: mocks.kind, label: "Clip" }],
    canEdit: mocks.canEdit,
    attachSource: mocks.attach,
    moveShotToIndex: mocks.move,
    insertShot: vi.fn(),
  }),
}));
vi.mock("@/components/media/use-video-poster", () => ({
  useVideoPoster: () => ({ data: undefined }),
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  mocks.canEdit = true;
  mocks.kind = "video";
  vi.clearAllMocks();
  mocks.attach.mockReturnValue(true);
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(Element.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <CanvasStoryboard>
        {(control) => (
          <>
            <div role="toolbar" aria-label="Canvas tools">
              {control}
            </div>
            <div className="react-flow__node" data-id="video">
              Canvas clip
            </div>
          </>
        )}
      </CanvasStoryboard>
    )
  );
}
async function click(text: string) {
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.getAttribute("aria-label") === text || button.textContent === text)!
      .click()
  );
}
async function pointer(type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
  await act(async () => container.querySelector(".react-flow__node")!.dispatchEvent(event));
}
describe("Canvas to storyboard gestures", () => {
  it("opens and closes the timeline from the labelled canvas toolbar entry", async () => {
    await render();
    const button = container.querySelector('[role="toolbar"] button')!;
    expect(button.getAttribute("aria-label")).toBe("title");
    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("section")).toBeNull();
    await click("title");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("section")).not.toBeNull();
    await click("title");
    expect(container.querySelector("section")).toBeNull();
    await pointer("pointerdown", 0, 0);
    expect(mocks.select).not.toHaveBeenCalledWith(["video"]);
  });

  it("leaves normal canvas dragging alone until the mode is enabled", async () => {
    await render();
    await pointer("pointerdown", 0, 0);
    expect(mocks.select).not.toHaveBeenCalledWith(["video"]);
    expect(mocks.attach).not.toHaveBeenCalled();
  });
  it.each(["video", "image"])("selects then attaches %s on a moved pointer drop", async (kind) => {
    mocks.kind = kind;
    await render();
    await click("title");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      container.querySelector("[data-storyboard-shot]")
    );
    await pointer("pointerdown", 0, 0);
    expect(mocks.select).not.toHaveBeenCalledWith(["video"]);
    await pointer("pointermove", 100, 100);
    await pointer("pointerup", 100, 100);
    expect(mocks.attach).toHaveBeenCalledWith("shot", "video");
  });
  it("a click only selects; it does not attach", async () => {
    await render();
    await click("title");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      container.querySelector("[data-storyboard-shot]")
    );
    await pointer("pointerdown", 0, 0);
    await pointer("pointerup", 0, 0);
    expect(mocks.attach).not.toHaveBeenCalled();
  });
  it("cancels a gesture without creating an attachment", async () => {
    await render();
    await click("title");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      container.querySelector("[data-storyboard-shot]")
    );
    await pointer("pointerdown", 0, 0);
    await pointer("pointermove", 100, 100);
    await pointer("pointercancel", 100, 100);
    await pointer("pointerup", 100, 100);
    expect(mocks.attach).not.toHaveBeenCalled();
  });
  it("does not show a success announcement for a rejected attachment", async () => {
    mocks.attach.mockReturnValue(false);
    await render();
    await click("title");
    await click("placeSelected");
    expect(container.querySelector('[role="status"]')!.textContent).toBe("");
  });
  it("does not expose editing controls to viewers", async () => {
    mocks.canEdit = false;
    await render();
    await click("title");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "mode" || button.textContent === "placeSelected"
      )
    ).toBe(false);
  });
});

it("reorders shots with pointer gestures and keyboard without a text footer", async () => {
  await render();
  await click("title");
  const handle = container.querySelector("[data-reorder-shot]")!;
  await act(async () =>
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
  );
  expect(mocks.move).toHaveBeenCalledWith("shot", 1);
  expect(container.textContent).not.toContain("placeSelected");
  expect(container.querySelector("[data-storyboard-shot]")?.parentElement?.className).toContain(
    "lg:grid-cols-6"
  );
});
