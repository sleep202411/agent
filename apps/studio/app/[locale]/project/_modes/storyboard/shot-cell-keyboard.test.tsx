// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next-intl", () => ({ useTranslations: () => (s: string) => s }));
import { ShotTextCell } from "./shot-text-cell";
import { ShotDurationCell } from "./shot-duration-cell";
let root: Root, host: HTMLDivElement;
const commit = vi.fn(),
  navigate = vi.fn();
function Cell({ kind }: { kind: string }) {
  const props = { ariaLabel: "cell", readOnly: false, onCommit: commit, onNavigate: navigate };
  return kind === "text" ? (
    <ShotTextCell {...props} value="old" placeholder="text" />
  ) : (
    <ShotDurationCell {...props} value={12} />
  );
}
function key(target: Element, key: string, other: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...other });
  act(() => target.dispatchEvent(event));
  return event;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  commit.mockClear();
  navigate.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  host.remove();
});
it.each(["text", "duration"])("preserves the first typed character in %s cells", async (kind) => {
  await act(async () => root.render(<Cell kind={kind} />));
  key(host.querySelector('[role="button"]')!, "5");
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")!;
  expect(input.value).toBe("5");
  expect(input.selectionStart).toBe(1);
  expect(input.selectionEnd).toBe(1);
  await act(async () => vi.advanceTimersByTime(800));
  expect(commit).toHaveBeenCalledWith(kind === "text" ? "5" : 5);
});
it.each(["text", "duration"])("does not start %s editing on a modified shortcut", async (kind) => {
  await act(async () => root.render(<Cell kind={kind} />));
  const button = host.querySelector('[role="button"]')!;
  expect(key(button, "c", { metaKey: true }).defaultPrevented).toBe(false);
  expect(host.querySelector("input,textarea")).toBeNull();
  expect(commit).not.toHaveBeenCalled();
});
it.each(["text", "duration"])("does not commit or navigate %s during composition", async (kind) => {
  await act(async () => root.render(<Cell kind={kind} />));
  key(host.querySelector('[role="button"]')!, "Enter");
  const input = host.querySelector("input,textarea")!;
  expect(key(input, "Enter", { isComposing: true }).defaultPrevented).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  expect(host.querySelector("input,textarea")).toBe(input);
  key(input, "Enter");
  expect(navigate).toHaveBeenCalledWith("down");
});
