import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useGridNavigation } from "./use-grid-navigation";
vi.mock("./storyboard-columns", () => ({
  EDITABLE_COLUMN_KEYS: ["first", "last"],
  cellDomId: (row: string, col: string) => `cell-${row}-${col}`,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
afterEach(() => {
  if (root) act(() => root.unmount());
  document.body.replaceChildren();
});
function setup() {
  let api: ReturnType<typeof useGridNavigation>;
  const scroll = vi.fn();
  function Harness() {
    api = useGridNavigation({ rowCount: 3, scrollToIndex: scroll });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  return {
    get api() {
      return api!;
    },
    scroll,
  };
}
function cell(row: string, col = "first") {
  const el = document.createElement("button");
  el.id = `cell-${row}-${col}`;
  document.body.append(el);
  return el;
}
it("keeps the pending target identity when rows reorder", () => {
  const h = setup();
  act(() => h.api.moveFocus("down", 0, "first", ["a", "b", "c"]));
  const intended = cell("b");
  cell("c");
  act(() => h.api.resolvePendingFocus(["a", "c", "b"]));
  expect(document.activeElement).toBe(intended);
});
it("cancels a pending target removed from the list", () => {
  const h = setup();
  act(() => h.api.moveFocus("down", 0, "first", ["a", "b", "c"]));
  const other = cell("c");
  act(() => h.api.resolvePendingFocus(["a", "c"]));
  expect(document.activeElement).not.toBe(other);
  expect(h.api.pendingFocus).toBeNull();
});
it("a newer mounted target supersedes older deferred focus", () => {
  const h = setup();
  act(() => h.api.moveFocus("down", 0, "first", ["a", "b", "c"]));
  const latest = cell("c");
  act(() => h.api.moveFocus("down", 1, "first", ["a", "b", "c"]));
  cell("b");
  act(() => h.api.resolvePendingFocus(["a", "b", "c"]));
  expect(document.activeElement).toBe(latest);
  expect(h.api.pendingFocus).toBeNull();
});
it("wraps columns across rows and stops at table edges", () => {
  const h = setup();
  const b = cell("b");
  act(() => h.api.moveFocus("next", 0, "last", ["a", "b", "c"]));
  expect(document.activeElement).toBe(b);
  act(() => h.api.moveFocus("prev", 0, "first", ["a", "b", "c"]));
  expect(document.activeElement).toBe(b);
  expect(h.scroll).not.toHaveBeenCalled();
});
it("waits for an unmounted row then resolves once it mounts", () => {
  const h = setup();
  act(() => h.api.moveFocus("down", 0, "first", ["a", "b", "c"]));
  act(() => h.api.resolvePendingFocus(["a", "b", "c"]));
  expect(h.api.pendingFocus).not.toBeNull();
  const b = cell("b");
  act(() => h.api.resolvePendingFocus(["a", "b", "c"]));
  expect(document.activeElement).toBe(b);
  expect(h.api.pendingFocus).toBeNull();
});
