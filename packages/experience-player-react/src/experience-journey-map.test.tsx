// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExperienceJourneyMap, type ExperienceJourneyMapProps } from "./experience-journey-map";
import type { ExperienceJourneyMapGraph } from "./experience-journey-model";
import { journeyMapTestCopy as copy } from "./experience-journey-test-copy";

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onReplay = vi.fn();
const onStageTap = vi.fn();
let viewportWidth: number;
let viewportHeight: number;

/** Keep React Flow real; jsdom needs only the browser's measured layout primitives. */
function mockCanvasMeasurements() {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement
  ) {
    if (this.getAttribute("role") === "tooltip")
      return this.hidden
        ? 0
        : Math.min(320, viewportWidth - 24, Number.parseFloat(this.style.maxWidth) || Infinity);
    return this.classList.contains("react-flow__handle")
      ? 6
      : Number.parseFloat(this.style.width) || viewportWidth;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement
  ) {
    if (this.getAttribute("role") === "tooltip")
      return this.hidden ? 0 : Math.min(84, Number.parseFloat(this.style.maxHeight) || Infinity);
    return this.classList.contains("react-flow__handle")
      ? 6
      : Number.parseFloat(this.style.height) || viewportHeight;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement
  ) {
    return this.offsetWidth;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement
  ) {
    return this.offsetHeight;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    const node = this.closest<HTMLElement>(".react-flow__node");
    const position = (node ?? this).style.transform.match(
      /translate\(([-.\d]+)px,\s*([-.\d]+)px\)/
    );
    let x = position ? Number(position[1]) : 0;
    let y = position ? Number(position[2]) : 0;
    if (this.classList.contains("react-flow__handle")) {
      x += this.classList.contains("source") ? 205 : -3;
      y += 57;
    }
    const width = this.offsetWidth;
    const height = this.offsetHeight;
    return {
      x,
      y,
      top: y,
      left: x,
      right: x + width,
      bottom: y + height,
      width,
      height,
      toJSON: () => ({}),
    };
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22 = 1;
    }
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0)
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
}

function graphFixture(): ExperienceJourneyMapGraph {
  return {
    nodes: [
      { sceneId: "entry", kind: "scene", visited: true, replayable: true },
      { sceneId: "left", kind: "scene", visited: true, replayable: true },
      { sceneId: "right", kind: "scene", visited: false, replayable: false },
      { sceneId: "merge", kind: "scene", visited: true, replayable: false },
      { sceneId: "@ending:good", kind: "ending", visited: true, replayable: false },
    ],
    edges: [
      {
        edgeId: "left-route",
        fromSceneId: "entry",
        toSceneId: "left",
        traversed: true,
        segments: [],
      },
      {
        edgeId: "right-route",
        fromSceneId: "entry",
        toSceneId: "right",
        traversed: false,
        segments: [],
      },
      {
        edgeId: "left-merge",
        fromSceneId: "left",
        toSceneId: "merge",
        traversed: true,
        segments: [],
      },
      {
        edgeId: "right-merge",
        fromSceneId: "right",
        toSceneId: "merge",
        traversed: false,
        segments: [],
      },
      {
        edgeId: "end-route",
        fromSceneId: "merge",
        toSceneId: "@ending:good",
        traversed: true,
        segments: [],
      },
    ],
    truncated: false,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  viewportWidth = 1024;
  viewportHeight = 640;
  mockCanvasMeasurements();
  onClose.mockReset();
  onReplay.mockReset();
  onStageTap.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(overrides: Partial<ExperienceJourneyMapProps> = {}) {
  await act(async () => {
    root.render(
      <div onClick={onStageTap}>
        <ExperienceJourneyMap
          graph={graphFixture()}
          currentSceneId="left"
          nodeDetails={{
            entry: { title: "At the gate", thumbnailUrl: "/entry.png" },
            left: { title: "By the river" },
            merge: { title: "The crossroads" },
            "@ending:good": { title: "Reunited" },
          }}
          copy={copy}
          onClose={onClose}
          onReplay={onReplay}
          {...overrides}
        />
      </div>
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function button(label: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.getAttribute("aria-label") === label || item.textContent === label
  )!;
}

function keydown(key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  act(() => document.activeElement?.dispatchEvent(event));
  return event;
}

function explanation() {
  return document.body.querySelector<HTMLElement>('[role="tooltip"]')!;
}
async function settle(action: () => void) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
function mouse(type: string, init: MouseEventInit = {}) {
  const event = new MouseEvent(type, {
    bubbles: type !== "mouseenter" && type !== "mouseleave",
    cancelable: true,
    ...init,
  });
  // Vitest proxies Window, which jsdom rejects in the UIEvent constructor.
  Object.defineProperty(event, "view", { value: document.defaultView });
  return event;
}

describe("story map dialog", () => {
  it("overlays the player transparently with full-card landscape previews and mystery nodes", async () => {
    await render();
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog.parentElement?.className).toContain("fixed inset-0");
    expect(dialog.parentElement?.className).toContain("bg-black/55");
    expect(dialog.className).not.toMatch(/bg-neutral-950|bg-black(?:\s|$)/);
    expect(dialog.querySelector('[role="application"]')?.className).toContain("absolute inset-0");
    const explored = dialog.querySelector<HTMLElement>('[data-journey-node="entry"]')!;
    expect(Number.parseFloat(explored.style.width)).toBeGreaterThan(
      Number.parseFloat(explored.style.height)
    );
    expect(explored.querySelector("img")?.parentElement?.className).toContain("absolute inset-0");
    expect(explored.querySelector(".tabler-icon-player-play")).not.toBeNull();
    expect(explored.querySelector(".tabler-icon-check")).not.toBeNull();
    const mystery = dialog.querySelector('[data-journey-node="right"]')!;
    expect(mystery.textContent).toBe("???");
    expect(mystery.querySelector(".tabler-icon-lock")).not.toBeNull();
    expect(mystery.querySelector("img")).toBeNull();
    expect(mystery.querySelector("button")?.getAttribute("aria-label")).toBe(copy.unexplored);
    expect(dialog.querySelector<HTMLElement>(".react-flow")?.style.backgroundColor).toBe(
      "transparent"
    );
    expect(
      dialog.querySelector(".react-flow__controls, .react-flow__minimap, .react-flow__attribution")
    ).toBeNull();
  });

  it("renders nothing during server rendering and moves the portal into the native fullscreen root", async () => {
    const props = { graph: graphFixture(), currentSceneId: "left", copy, onClose, onReplay };
    expect(renderToStaticMarkup(<ExperienceJourneyMap {...props} />)).toBe("");
    await render();
    const fullscreen = document.createElement("div");
    document.body.append(fullscreen);
    let target: Element | null = fullscreen;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => target });
    await act(async () => document.dispatchEvent(new Event("fullscreenchange")));
    expect(fullscreen.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    target = null;
    await act(async () => document.dispatchEvent(new Event("fullscreenchange")));
    expect(fullscreen.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')?.parentElement?.parentElement).toBe(
      document.body
    );
    fullscreen.remove();
    Reflect.deleteProperty(document, "fullscreenElement");
  });

  it("labels the dialog and canvas, highlights the current scene and distinguishes explored routes", async () => {
    await render();
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe(
      copy.title
    );
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe(
      copy.description
    );
    expect(document.body.querySelector('[role="application"]')?.getAttribute("aria-label")).toBe(
      copy.canvasLabel
    );
    expect(button(`${copy.replay}: By the river`).getAttribute("aria-current")).toBe("step");
    expect(document.body.querySelectorAll('[data-current="true"]')).toHaveLength(1);
    const taken = document.body.querySelector<SVGElement>(
      '[data-id="left-route"] .react-flow__edge-path'
    )!;
    const untaken = document.body.querySelector<SVGElement>(
      '[data-id="right-route"] .react-flow__edge-path'
    )!;
    expect(taken.style.strokeDasharray).toBe("");
    expect(untaken.style.strokeDasharray).toBe("4 5");
  });

  it("never reads or renders an unexplored scene's title or thumbnail, even if it has a replay flag", async () => {
    const graph = graphFixture();
    graph.nodes[2]!.replayable = true;
    const details = new Proxy(
      { entry: { title: "At the gate" } },
      {
        get(target, property) {
          if (property === "right") throw new Error("Unexplored details must stay private");
          return Reflect.get(target, property);
        },
      }
    );
    await render({ graph, nodeDetails: details });
    const unknown = button(copy.unexplored);
    expect(unknown).not.toBeNull();
    expect(unknown.querySelector("img")).toBeNull();
    expect(button(`${copy.replay}: Unexplored`)).toBeUndefined();
    expect(document.body.textContent).not.toContain("right");
    act(() => (unknown as HTMLElement).click());
    expect(onReplay).not.toHaveBeenCalled();
  });

  it("explains an unexplored scene on hover and lets the pointer cross into the readable hint", async () => {
    await render();
    const unknown = button(copy.unexplored);
    expect(explanation().hidden).toBe(true);
    await settle(() => unknown.dispatchEvent(mouse("mouseover", { clientX: 390, clientY: 180 })));
    const hint = explanation();
    expect(hint.hidden).toBe(false);
    expect(hint.style.visibility).toBe("visible");
    expect(hint.textContent).toBe(copy.unexploredHint);
    expect(hint.getAttribute("id")).toBe(unknown.getAttribute("aria-describedby"));
    expect(hint.closest('[role="dialog"]')).not.toBeNull();
    expect(hint.closest(".react-flow__viewport")).toBeNull();
    await settle(() => {
      unknown.dispatchEvent(
        mouse("mouseleave", { clientX: 390, clientY: 164, relatedTarget: hint })
      );
      hint.dispatchEvent(
        mouse("mouseenter", { clientX: 390, clientY: 150, relatedTarget: unknown })
      );
      hint.dispatchEvent(mouse("mousemove", { clientX: 390, clientY: 150 }));
    });
    expect(hint.hidden).toBe(false);
    await settle(() => {
      hint.dispatchEvent(
        mouse("mouseleave", { clientX: 10, clientY: 10, relatedTarget: document.body })
      );
      document.body.dispatchEvent(mouse("mousemove", { clientX: 10, clientY: 10 }));
    });
    expect(hint.hidden).toBe(true);
    expect(onReplay).not.toHaveBeenCalled();
  });

  it("shows the hint on keyboard focus, dismisses on blur, and gives it the first Escape", async () => {
    await render();
    const unknown = button(copy.unexplored);
    await settle(() => unknown.focus());
    expect(explanation().hidden).toBe(false);
    expect(explanation().style.visibility).toBe("visible");
    expect(keydown("Escape").defaultPrevented).toBe(true);
    expect(explanation().hidden).toBe(true);
    expect(document.activeElement).toBe(unknown);
    expect(onClose).not.toHaveBeenCalled();
    await settle(() => {});
    expect(explanation().hidden).toBe(true);
    expect(keydown("Escape").defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    await settle(() => button(copy.close).focus());
    await settle(() => unknown.focus());
    expect(explanation().hidden).toBe(false);
    await settle(() => button(copy.close).focus());
    expect(explanation().hidden).toBe(true);
    expect(onReplay).not.toHaveBeenCalled();
  });

  it("closes a hover explanation when the pointer leaves the window", async () => {
    await render();
    await settle(() => button(copy.unexplored).dispatchEvent(mouse("mouseover")));
    expect(explanation().hidden).toBe(false);
    await settle(() => document.documentElement.dispatchEvent(mouse("mouseleave")));
    expect(explanation().hidden).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps an Escape dismissal closed when removing the hint exposes the hovered card", async () => {
    await render();
    const unknown = button(copy.unexplored);
    await settle(() => {
      unknown.dispatchEvent(mouse("mouseover"));
      unknown.focus();
      unknown.click();
    });
    expect(explanation().hidden).toBe(false);
    keydown("Escape");
    await settle(() => unknown.dispatchEvent(mouse("mouseover")));
    expect(explanation().hidden).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await settle(() => {
      unknown.dispatchEvent(mouse("mouseout", { relatedTarget: document.body }));
      unknown.dispatchEvent(mouse("mouseover", { relatedTarget: document.body }));
    });
    expect(explanation().hidden).toBe(false);
    keydown("Escape");
    await settle(() => unknown.click());
    expect(explanation().hidden).toBe(false);
  });

  it("shows the hint on touch or click and dismisses on blank space or an explored replay", async () => {
    await render();
    const unknown = button(copy.unexplored);
    const touch = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(touch, "pointerType", { value: "touch" });
    await settle(() => {
      unknown.dispatchEvent(touch);
      unknown.click();
    });
    expect(explanation().hidden).toBe(false);
    expect(unknown.disabled).toBe(false);
    expect(unknown.classList.contains("nopan")).toBe(false);
    expect(onReplay).not.toHaveBeenCalled();
    expect(onStageTap).not.toHaveBeenCalled();
    await settle(() =>
      document.body
        .querySelector(".react-flow__pane")!
        .dispatchEvent(new Event("pointerdown", { bubbles: true }))
    );
    expect(explanation().hidden).toBe(true);
    await settle(() => unknown.click());
    expect(explanation().hidden).toBe(false);
    await settle(() => document.body.querySelector<HTMLElement>(".react-flow__pane")!.click());
    expect(explanation().hidden).toBe(true);
    await settle(() => unknown.click());
    await settle(() => button(`${copy.replay}: At the gate`).click());
    expect(explanation().hidden).toBe(true);
    expect(onReplay).toHaveBeenCalledExactlyOnceWith("entry");
  });

  it("shows the explanation after a real press-release-click while keeping canvas pan enabled", async () => {
    await render();
    const unknown = button(copy.unexplored);
    await settle(() =>
      unknown.dispatchEvent(
        mouse("mousedown", { clientX: 390, clientY: 200, button: 0, buttons: 1 })
      )
    );
    await act(async () => {
      window.dispatchEvent(mouse("mouseup", { clientX: 390, clientY: 200, button: 0 }));
      unknown.focus();
      unknown.dispatchEvent(mouse("click", { clientX: 390, clientY: 200, button: 0 }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(explanation().hidden).toBe(false);
    expect(explanation().style.visibility).toBe("visible");
    expect(onReplay).not.toHaveBeenCalled();
    expect(onStageTap).not.toHaveBeenCalled();
  });

  it("allows panning from the mystery card and suppresses hover or focus hints during movement", async () => {
    await render();
    const unknown = button(copy.unexplored);
    const viewport = document.body.querySelector<HTMLElement>(".react-flow__viewport")!;
    await settle(() => unknown.click());
    const before = viewport.style.transform;
    await settle(() =>
      unknown.dispatchEvent(
        mouse("mousedown", { clientX: 390, clientY: 200, button: 0, buttons: 1 })
      )
    );
    expect(explanation().hidden).toBe(true);
    await settle(() => {
      unknown.dispatchEvent(mouse("mouseover", { clientX: 390, clientY: 200 }));
      unknown.focus();
      window.dispatchEvent(mouse("mousemove", { clientX: 460, clientY: 240, buttons: 1 }));
    });
    expect(explanation().hidden).toBe(true);
    expect(viewport.style.transform).not.toBe(before);
    await settle(() => {
      window.dispatchEvent(mouse("mouseup", { clientX: 460, clientY: 240, button: 0 }));
      unknown.dispatchEvent(mouse("click", { clientX: 460, clientY: 240, button: 0 }));
    });
    expect(explanation().hidden).toBe(true);
    expect(onReplay).not.toHaveBeenCalled();
  });

  it("dismisses while zooming and keeps the reopened tooltip unscaled inside a narrow viewport", async () => {
    viewportWidth = 320;
    viewportHeight = 240;
    await render();
    const unknown = button(copy.unexplored);
    const rect = {
      x: 302,
      y: 6,
      left: 302,
      top: 6,
      right: 410,
      bottom: 66,
      width: 108,
      height: 60,
      toJSON: () => ({}),
    };
    vi.spyOn(unknown, "getBoundingClientRect").mockImplementation(() => rect);
    await settle(() => unknown.click());
    const hint = explanation();
    expect(hint.style.visibility).toBe("visible");
    expect(hint.style.position).toBe("fixed");
    const coords = hint.style.transform.match(/translate\(([-.\d]+)px,\s*([-.\d]+)px\)/)!;
    expect(Number(coords[1])).toBeGreaterThanOrEqual(12);
    expect(Number(coords[1]) + hint.offsetWidth).toBeLessThanOrEqual(viewportWidth - 12);
    expect(Number(coords[2])).toBeGreaterThanOrEqual(12);
    expect(Number(coords[2]) + hint.offsetHeight).toBeLessThanOrEqual(viewportHeight - 12);
    expect(hint.style.transform).not.toContain("scale");
    await settle(() =>
      document.body.querySelector(".react-flow__pane")!.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: -120,
          clientX: 200,
          clientY: 100,
        })
      )
    );
    expect(hint.hidden).toBe(true);
    await settle(() => unknown.focus());
    expect(hint.hidden).toBe(true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 170));
    });
    await settle(() => unknown.click());
    expect(hint.hidden).toBe(false);
    expect(hint.style.visibility).toBe("visible");
    expect(hint.style.transform).not.toContain("scale");
    expect(onReplay).not.toHaveBeenCalled();
  });

  it("replays only explored scene entry anchors and explains when the entry point is unavailable", async () => {
    await render();
    act(() => button(`${copy.replay}: At the gate`).click());
    expect(onReplay).toHaveBeenCalledExactlyOnceWith("entry");
    expect(onStageTap).not.toHaveBeenCalled();
    const noAnchor = document.body.querySelector('[role="group"][aria-label="The crossroads"]')!;
    expect(noAnchor.getAttribute("title")).toBe(copy.replayUnavailable);
    expect(button(`${copy.replay}: Reunited`)).toBeUndefined();
    expect(document.body.textContent).toContain(copy.replayHint);
  });

  it("blocks repeated replay while a restore is pending and keeps close available", async () => {
    await render({ replayPending: true });
    expect(document.body.querySelector('[role="status"]')?.textContent).toBe(copy.replaying);
    expect(button(`${copy.replay}: At the gate`).disabled).toBe(true);
    act(() => button(`${copy.replay}: At the gate`).click());
    expect(onReplay).not.toHaveBeenCalled();
    act(() => button(copy.close).click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows the original replay failure inside the dialog and keeps recovery controls available", async () => {
    const error =
      "Saved playback no longer matches this scene.\nPlease choose another saved entry.";
    await render({ error });
    const dialog = document.body.querySelector('[role="dialog"]')!;
    const alert = dialog.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toBe(error);
    expect(alert.hidden).toBe(false);
    expect(alert.getAttribute("aria-hidden")).not.toBe("true");
    expect(button(`${copy.replay}: At the gate`).disabled).toBe(false);
    act(() => button(copy.close).click());
    expect(onClose).toHaveBeenCalledOnce();
    await render();
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });

  it("focuses close, contains Tab and outside focus, and closes on Escape without reaching the player", async () => {
    await render();
    const close = button(copy.close);
    const last = button(copy.unexplored);
    expect(document.activeElement).toBe(close);
    act(() => button(copy.centerCurrent).focus());
    expect(keydown("Tab", true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect(keydown("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button(copy.centerCurrent));
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    expect(document.activeElement).toBe(close);
    const bubble = vi.fn();
    document.addEventListener("keydown", bubble);
    expect(keydown("Escape").defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(bubble).not.toHaveBeenCalled();
    document.removeEventListener("keydown", bubble);
    outside.remove();
  });

  it("uses the latest close callback and removes modal listeners after it closes", async () => {
    await render();
    const latestClose = vi.fn();
    await render({ onClose: latestClose });
    keydown("Escape");
    expect(onClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledOnce();
    act(() => root.render(<button>Outside</button>));
    const outside = document.body.querySelector("button")!;
    act(() => outside.focus());
    expect(document.activeElement).toBe(outside);
    expect(keydown("Escape").defaultPrevented).toBe(false);
    expect(latestClose).toHaveBeenCalledOnce();
  });

  it("pans the real canvas with the keyboard, centers the current node and retains focus on rerender", async () => {
    const graph = graphFixture();
    await render({ graph });
    const canvas = document.body.querySelector<HTMLDivElement>('[role="application"]')!;
    const viewport = document.body.querySelector<HTMLElement>(".react-flow__viewport")!;
    expect(viewport.style.transform).not.toBe("translate(0px,0px) scale(1)");
    act(() => canvas.focus());
    const initialTransform = viewport.style.transform;
    await act(async () => {
      keydown("ArrowRight");
    });
    expect(viewport.style.transform).not.toBe(initialTransform);
    await act(async () => button(copy.centerCurrent).click());
    const centeredTransform = viewport.style.transform;
    await act(async () => {
      keydown("ArrowDown");
    });
    expect(viewport.style.transform).not.toBe(centeredTransform);
    await act(async () => button(copy.centerCurrent).click());
    expect(viewport.style.transform).toBe(centeredTransform);
    await render({ graph });
    expect(document.activeElement).toBe(canvas);
  });

  it("uses the real canvas drag and wheel zoom without sending taps to the player", async () => {
    await render();
    const pane = document.body.querySelector<HTMLElement>(".react-flow__pane")!;
    const viewport = document.body.querySelector<HTMLElement>(".react-flow__viewport")!;
    const initial = viewport.style.transform;
    await act(async () => {
      pane.dispatchEvent(mouse("mousedown", { clientX: 100, clientY: 100, button: 0, buttons: 1 }));
      window.dispatchEvent(mouse("mousemove", { clientX: 170, clientY: 140, buttons: 1 }));
      window.dispatchEvent(mouse("mouseup", { clientX: 170, clientY: 140, button: 0 }));
    });
    const afterDrag = viewport.style.transform;
    expect(afterDrag).not.toBe(initial);
    await act(async () => {
      pane.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 200,
          clientY: 160,
          deltaY: -120,
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(viewport.style.transform).not.toBe(afterDrag);
    expect(onStageTap).not.toHaveBeenCalled();
    expect(onReplay).not.toHaveBeenCalled();
  });

  it("lays out branch merges, duplicate routes and disconnected cycles on a finite canvas", async () => {
    const graph = graphFixture();
    graph.nodes.push(
      { sceneId: "cycle-a", kind: "scene", visited: false, replayable: false },
      { sceneId: "cycle-b", kind: "scene", visited: false, replayable: false }
    );
    graph.edges.push(
      {
        edgeId: "alternate-left",
        fromSceneId: "entry",
        toSceneId: "left",
        traversed: false,
        segments: [],
      },
      { edgeId: "back", fromSceneId: "merge", toSceneId: "entry", traversed: true, segments: [] },
      { edgeId: "self", fromSceneId: "left", toSceneId: "left", traversed: true, segments: [] },
      {
        edgeId: "cycle-forward",
        fromSceneId: "cycle-a",
        toSceneId: "cycle-b",
        traversed: false,
        segments: [],
      },
      {
        edgeId: "cycle-back",
        fromSceneId: "cycle-b",
        toSceneId: "cycle-a",
        traversed: false,
        segments: [],
      }
    );
    await render({ graph });
    expect(document.body.querySelectorAll("[data-journey-node]")).toHaveLength(graph.nodes.length);
    const paths = [...document.body.querySelectorAll(".react-flow__edge-path")];
    expect(paths).toHaveLength(graph.edges.length);
    for (const path of paths) expect(path.getAttribute("d")).not.toMatch(/NaN|Infinity/);
    for (const node of document.body.querySelectorAll<HTMLElement>(".react-flow__node")) {
      expect(node.style.transform).toMatch(/^translate\([\d.]+px,\s*[\d.]+px\)$/);
      expect(node.getAttribute("tabindex")).toBeNull();
      expect(node.classList.contains("draggable")).toBe(false);
      expect(node.classList.contains("selectable")).toBe(false);
    }
  });

  it("announces empty and explicitly truncated maps", async () => {
    await render({ graph: { nodes: [], edges: [], truncated: true } });
    expect(document.body.textContent).toContain(copy.empty);
    expect(document.body.querySelector('[role="status"]')?.textContent).toBe(copy.truncated);
    expect(button(copy.centerCurrent).disabled).toBe(true);
    expect(document.body.querySelector('[role="application"]')).toBeNull();
  });

  it("identifies failed thumbnails and tries a new thumbnail URL after it changes", async () => {
    await render();
    const image = document.body.querySelector("img")!;
    act(() => image.dispatchEvent(new Event("error")));
    expect(
      document.body
        .querySelector('[data-journey-node="entry"] [role="img"]')
        ?.getAttribute("aria-label")
    ).toBe(copy.thumbnailUnavailable);
    expect(document.body.querySelector("img")).toBeNull();
    await render({
      nodeDetails: { entry: { title: "At the gate", thumbnailUrl: "/new-entry.png" } },
    });
    expect(document.body.querySelector("img")?.getAttribute("src")).toBe("/new-entry.png");
    expect(document.body.querySelector('[data-journey-node="entry"] [role="img"]')).toBeNull();
  });
});
