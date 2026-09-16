// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDismiss } from "./use-dismiss";
let host: HTMLDivElement, root: Root;
const dismiss = vi.fn();
function Probe({ open = true }: { open?: boolean }) {
  useDismiss(open, dismiss);
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  dismiss.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("leaves composition Escape to the input method", async () => {
  await act(async () => root.render(<Probe />));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true }));
  expect(dismiss).not.toHaveBeenCalled();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(dismiss).toHaveBeenCalledOnce();
});
it("releases dismissal events after closing", async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => root.render(<Probe open={false} />));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(dismiss).not.toHaveBeenCalled();
});
