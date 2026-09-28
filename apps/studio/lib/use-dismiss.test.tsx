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

it.each(["document", "text"])(
  "handles a %s pointer target without assuming an HTMLElement",
  async (kind) => {
    const add = vi.spyOn(document, "addEventListener");
    await act(async () => root.render(<Probe />));
    const listener = add.mock.calls.find(([type]) => type === "pointerdown")?.[1] as EventListener;
    add.mockRestore();
    const zone = document.createElement("span");
    zone.dataset.popoverZone = "";
    const text = document.createTextNode("inside");
    zone.append(text);
    const target = kind === "document" ? document : text;
    expect(() => listener({ target } as unknown as Event)).not.toThrow();
    expect(dismiss).toHaveBeenCalledTimes(kind === "document" ? 1 : 0);
  }
);
