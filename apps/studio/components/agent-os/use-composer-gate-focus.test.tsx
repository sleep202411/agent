import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useComposerGateFocus } from "./use-composer-gate-focus";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
beforeEach(() => {
  frames = new Map();
  sequence = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.set(++sequence, cb);
    return sequence;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});
afterEach(() => {
  if (root) act(() => root.unmount());
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
function flush() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((cb) => cb(0)));
}
function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  function Gate() {
    const ref = useComposerGateFocus<HTMLButtonElement>("approval");
    return createElement(
      "div",
      { "data-agent-composer-gate": true },
      createElement("button", { ref }, "Approve")
    );
  }
  act(() => root.render(createElement(Gate)));
  return {
    close() {
      act(() => root.render(null));
    },
  };
}
function input() {
  const el = document.createElement("input");
  el.dataset.agentComposerInput = "";
  document.body.append(el);
  return el;
}
it("focuses the gate on the next frame", () => {
  mount();
  flush();
  expect(document.activeElement?.textContent).toBe("Approve");
});
it("restores the recreated composer when focus is otherwise unclaimed", () => {
  const gate = mount();
  flush();
  gate.close();
  const composer = input();
  flush();
  expect(document.activeElement).toBe(composer);
});
it("does not steal focus claimed between closing the gate and the restoration frame", () => {
  const gate = mount();
  flush();
  gate.close();
  input();
  const other = document.createElement("button");
  document.body.append(other);
  other.focus();
  flush();
  expect(document.activeElement).toBe(other);
});
it("keeps focus outside the gate when already moved before closing", () => {
  const gate = mount();
  flush();
  const other = document.createElement("button");
  document.body.append(other);
  other.focus();
  gate.close();
  input();
  flush();
  expect(document.activeElement).toBe(other);
});
