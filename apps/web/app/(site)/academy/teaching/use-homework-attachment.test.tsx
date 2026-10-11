// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useHomeworkAttachment } from "./use-homework-attachment";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let view: ReturnType<typeof useHomeworkAttachment>;
function mount() {
  root = createRoot(document.createElement("div"));
  function Probe() {
    view = useHomeworkAttachment();
    return null;
  }
  act(() => root.render(<Probe />));
}
afterEach(() => {
  act(() => root?.unmount());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("reserves the tab before awaiting the URL and prevents duplicate requests", async () => {
  const target = { opener: {}, closed: false, location: { replace: vi.fn() }, close: vi.fn() };
  const popup = vi.spyOn(window, "open").mockReturnValue(target as unknown as Window);
  let resolve!: (url: string) => void;
  const load = vi.fn(() => {
    expect(popup).toHaveBeenCalled();
    return new Promise<string>((r) => {
      resolve = r;
    });
  });
  mount();
  let request!: Promise<void>;
  act(() => {
    request = view.open("asset", load, vi.fn());
  });
  expect(target.opener).toBeNull();
  expect(view.pending).toBe(true);
  await act(async () => {
    await view.open("asset", load, vi.fn());
  });
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve("https://files.test/attachment");
    await request;
  });
  expect(target.location.replace).toHaveBeenCalledWith("https://files.test/attachment");
  expect(view.pending).toBe(false);
  expect(view.link).toBeNull();
});
it.each(["blocked", "closed"])("offers a direct link for a %s tab and expires it", async (mode) => {
  vi.useFakeTimers();
  vi.spyOn(window, "open").mockReturnValue(
    mode === "blocked" ? null : ({ closed: true } as Window)
  );
  mount();
  await act(async () => {
    await view.open("asset", async () => "https://files.test/a", vi.fn());
  });
  expect(view.link).toEqual({ id: "asset", url: "https://files.test/a" });
  act(() => vi.advanceTimersByTime(60000));
  expect(view.link).toBeNull();
});
it("closes the reserved tab on failure and permits retry", async () => {
  const target = { close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(target as unknown as Window);
  const failed = vi.fn();
  mount();
  const error = new Error("Access denied");
  await act(async () => {
    await view.open(
      "asset",
      async () => {
        throw error;
      },
      failed
    );
  });
  expect(target.close).toHaveBeenCalled();
  expect(failed).toHaveBeenCalledWith(error);
  expect(view.pending).toBe(false);
  expect(view.link).toBeNull();
});
it("aborts on unmount without opening a late response", async () => {
  const target = { close: vi.fn(), location: { replace: vi.fn() } };
  vi.spyOn(window, "open").mockReturnValue(target as unknown as Window);
  let resolve!: (url: string) => void;
  let signal!: AbortSignal;
  const failed = vi.fn();
  mount();
  let request!: Promise<void>;
  act(() => {
    request = view.open(
      "asset",
      (s) => {
        signal = s;
        return new Promise((r) => {
          resolve = r;
        });
      },
      failed
    );
  });
  act(() => root.unmount());
  expect(signal.aborted).toBe(true);
  expect(target.close).toHaveBeenCalled();
  await act(async () => {
    resolve("https://files.test/a");
    await request;
  });
  expect(target.location.replace).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
});
