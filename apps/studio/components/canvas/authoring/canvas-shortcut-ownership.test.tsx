// @vitest-environment jsdom
import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCanvasTool } from "../use-canvas-tool";
import { useCanvasAuthoringShortcuts } from "./use-canvas-authoring-shortcuts";
import { AddNodeMenu } from "../add-node-menu";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const addNode = vi.fn();
function Harness() {
  const surface = useRef<HTMLDivElement>(null);
  const { activeTool } = useCanvasTool(surface, "pan");
  useCanvasAuthoringShortcuts({
    enabled: true,
    edges: [],
    getNodes: () => [],
    addNodesAndEdges: vi.fn(),
    selectNodes: vi.fn(),
    addNode,
  });
  return (
    <div ref={surface} tabIndex={0} data-testid="surface">
      <output>{activeTool}</output>
      <input aria-label="Prompt" />
    </div>
  );
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
  container.querySelector<HTMLElement>('[data-testid="surface"]')!.focus();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function key(value: string, shiftKey = false) {
  act(() =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true })
    )
  );
}
it("V selects the tool without creating a video node", () => {
  key("v");
  expect(container.querySelector("output")!.textContent).toBe("select");
  expect(addNode).not.toHaveBeenCalled();
});
it("Shift+V creates a video without changing the active tool", () => {
  key("V", true);
  expect(addNode).toHaveBeenCalledWith("generate-video");
  expect(container.querySelector("output")!.textContent).toBe("pan");
});
it("advertises the distinct video shortcut", () => {
  act(() => root.render(<AddNodeMenu left={0} top={0} onAction={addNode} />));
  const video = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("addNode.video")
  );
  expect(video?.textContent).toContain("SHIFT+V");
  act(() => video!.click());
  expect(addNode).toHaveBeenCalledWith("generate-video");
});
it("keeps image creation available", () => {
  key("i");
  expect(addNode).toHaveBeenCalledWith("generate-image");
});
it("D opens director desk without duplicating", () => {
  key("d");
  expect(addNode).toHaveBeenCalledWith("director-desk");
});
it("does not create video while typing", () => {
  container.querySelector("input")!.focus();
  key("V", true);
  expect(addNode).not.toHaveBeenCalled();
});
