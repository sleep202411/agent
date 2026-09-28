import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MotionEditor } from "./motion-editor";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const ctx = {
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
};
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.values(ctx)
    .filter((fn) => typeof fn === "function")
    .forEach((fn) => fn.mockClear());
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as any);
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 600;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<MotionEditor sourceNodeId="source" sourceUrl="test.jpg" onClose={() => {}} />);
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function pointer(type: string, id: number, button = 0) {
  const target = host.querySelector(".touch-none")!;
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerId: id, button, clientX: 20, clientY: 20 });
  act(() => target.dispatchEvent(event));
}
it("secondary mouse button does not paint", () => {
  pointer("pointerdown", 1, 2);
  expect(ctx.fill).not.toHaveBeenCalled();
});
it("another pointer cannot move or end the active stroke", () => {
  pointer("pointerdown", 1);
  pointer("pointermove", 2);
  expect(ctx.stroke).not.toHaveBeenCalled();
  pointer("pointerup", 2);
  pointer("pointermove", 1);
  expect(ctx.stroke).toHaveBeenCalledOnce();
});
it("another pointer cannot replace the active stroke", () => {
  pointer("pointerdown", 1);
  pointer("pointerdown", 2);
  expect(ctx.fill).toHaveBeenCalledOnce();
});
it("owner cancellation stops painting", () => {
  pointer("pointerdown", 1);
  pointer("pointercancel", 1);
  pointer("pointermove", 1);
  expect(ctx.stroke).not.toHaveBeenCalled();
});

vi.mock("next-intl", () => import("./motion-editor.test-mocks"));
vi.mock("@xyflow/react", () => import("./motion-editor.test-mocks"));
vi.mock("@tabler/icons-react", () => import("./motion-editor.test-mocks"));
vi.mock("sonner", () => import("./motion-editor.test-mocks"));
vi.mock("@/lib/utils", () => import("./motion-editor.test-mocks"));
vi.mock("@/lib/media-upload", () => import("./motion-editor.test-mocks"));
vi.mock("@/lib/canvas-authoring/use-ai-catalog", () => import("./motion-editor.test-mocks"));
vi.mock("@/lib/canvas-authoring/generation-api", () => import("./motion-editor.test-mocks"));
vi.mock("./operation-confirm-bar", () => import("./motion-editor.test-mocks"));
it("lost capture stops the stroke", () => {
  pointer("pointerdown", 1);
  pointer("lostpointercapture", 1);
  pointer("pointermove", 1);
  expect(ctx.stroke).not.toHaveBeenCalled();
});
