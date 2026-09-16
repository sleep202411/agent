import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
const h = vi.hoisted(() => ({ height: 1000 }));
vi.mock("./use-window-size", () => ({ useWindowSize: () => ({ height: h.height }) }));
vi.mock("./use-element-rect", () => ({ useBodyRect: () => ({ height: 2000 }) }));
import { useCursorVisibility } from "./use-cursor-visibility";
let root: Root, container: HTMLDivElement;
const handlers = new Map<string, () => void>();
let top: number;
let editor: Editor;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.height = 1000;
  top = 100;
  handlers.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  editor = {
    state: { selection: { from: 1 } },
    isDestroyed: false,
    view: { hasFocus: () => true, coordsAtPos: () => ({ top }) },
    on: vi.fn((name, fn) => handlers.set(name, fn)),
    off: vi.fn((name) => handlers.delete(name)),
  } as unknown as Editor;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
function Host() {
  useCursorVisibility({ editor, overlayHeight: 100 });
  return null;
}
it("keeps an edited selection visible without viewport changes", async () => {
  await act(async () => root.render(<Host />));
  expect(window.scrollTo).not.toHaveBeenCalled();
  top = 980;
  act(() => handlers.get("selectionUpdate")?.());
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 480, behavior: "smooth" });
});
it("does not scroll using an unmeasured zero viewport", async () => {
  h.height = 0;
  top = 980;
  await act(async () => root.render(<Host />));
  expect(window.scrollTo).not.toHaveBeenCalled();
});
it("releases the selection listener on departure", async () => {
  await act(async () => root.render(<Host />));
  await act(async () => root.render(null));
  expect(editor.off).toHaveBeenCalledWith("selectionUpdate", expect.any(Function));
  expect(handlers.size).toBe(0);
});
