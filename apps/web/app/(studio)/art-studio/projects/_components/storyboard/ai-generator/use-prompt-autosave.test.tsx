import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePromptAutosave } from "./use-prompt-autosave";
let root: Root;
let scope = "one";
let save: (value: string) => void;
let autosave: ReturnType<typeof usePromptAutosave>;
function View() {
  const value = usePromptAutosave(save, 800, scope);
  useLayoutEffect(() => {
    autosave = value;
  });
  return null;
}
async function render() {
  await act(async () => root.render(<View />));
}
beforeEach(async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  scope = "one";
  save = vi.fn();
  root = createRoot(document.createElement("div"));
  await render();
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
it("flushes the departing shot through its original callback, never the replacement callback", async () => {
  const first = save;
  autosave.schedule("first prompt");
  scope = "two";
  save = vi.fn();
  await render();
  await act(async () => vi.advanceTimersByTime(800));
  expect(first).toHaveBeenCalledExactlyOnceWith("first prompt");
  expect(save).not.toHaveBeenCalled();
});
it("keeps the trailing debounce across ordinary renders and saves the last edit", async () => {
  const first = save;
  autosave.schedule("first");
  await act(async () => vi.advanceTimersByTime(400));
  save = vi.fn();
  await render();
  autosave.schedule("second");
  await act(async () => vi.advanceTimersByTime(400));
  expect(first).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(400));
  expect(save).toHaveBeenCalledExactlyOnceWith("second");
});
it("rejects retained callbacks for a departed shot while allowing its replacement", async () => {
  const old = autosave.schedule;
  scope = "two";
  save = vi.fn();
  await render();
  autosave.schedule("new");
  old("abandoned");
  await act(async () => vi.advanceTimersByTime(800));
  expect(save).toHaveBeenCalledExactlyOnceWith("new");
});
it("flushes an empty edit exactly once on close and rejects late admission", async () => {
  autosave.schedule("");
  await act(async () => root.unmount());
  autosave.schedule("late");
  await act(async () => vi.advanceTimersByTime(800));
  expect(save).toHaveBeenCalledExactlyOnceWith("");
});
