import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSavedOpening } from "./use-saved-opening";
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, put: h.put, delete: h.delete } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const id = "11111111-1111-4111-8111-111111111111";
const saved = { saved: true };
let value: ReturnType<typeof useSavedOpening>;
function Probe({
  viewer = "user",
  generation = 1,
  locale = "en-US",
  selected = id,
  enabled = true,
}: {
  viewer?: string | null;
  generation?: number;
  locale?: string;
  selected?: string | null;
  enabled?: boolean;
}) {
  const state = useSavedOpening(generation, viewer, locale, selected, enabled);
  useEffect(() => {
    value = state;
  });
  return (
    <div>
      {state.saved ? "saved" : "unsaved"}:{state.known ? "known" : "unknown"}:{state.error}
    </div>
  );
}
const render = (props: Parameters<typeof Probe>[0] = {}) =>
  act(async () => root.render(<Probe {...props} />));
const toggle = () =>
  act(async () => {
    await value.toggle();
  });
function deferred<T>() {
  let resolve!: (x: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ saved: false });
  h.put.mockResolvedValue(saved);
  h.delete.mockResolvedValue({ saved: false });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("saves and unsaves through the official endpoints without automatic retries", async () => {
  await render();
  h.get.mockResolvedValue(saved);
  await toggle();
  expect(value.saved).toBe(true);
  expect(h.put).toHaveBeenCalledWith(
    `/positions/${id}/saved`,
    expect.objectContaining({ retry: false, service: "aurora", credentials: "include" })
  );
  h.get.mockResolvedValue({ saved: false });
  await toggle();
  expect(value.saved).toBe(false);
  expect(h.delete).toHaveBeenCalledWith(
    `/positions/${id}/saved`,
    expect.objectContaining({ retry: false })
  );
});
it("serializes taps and reads authoritative state after a lost write reply", async () => {
  await render();
  const d = deferred<unknown>();
  h.put.mockReturnValue(d.promise);
  let operation!: Promise<void>;
  await act(async () => {
    operation = value.toggle();
    void value.toggle();
  });
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(value.busy).toBe(true);
  h.get.mockResolvedValue(saved);
  await act(async () => {
    d.resolve(Promise.reject(new Error("Write reply lost")));
    await operation;
  });
  expect(value.saved).toBe(true);
  expect(value.error).toBe("Write reply lost");
  expect(h.put).toHaveBeenCalledTimes(1);
});
it("blocks another mutation until a failed read is explicitly recovered", async () => {
  await render();
  h.put.mockRejectedValue(new Error("Uncertain write"));
  h.get.mockRejectedValue(new Error("Read denied"));
  await toggle();
  expect(value.known).toBe(false);
  expect(value.error).toContain("Uncertain write");
  expect(value.error).toContain("Read denied");
  await toggle();
  expect(h.put).toHaveBeenCalledTimes(1);
  h.get.mockResolvedValue(saved);
  await act(async () => value.retry());
  expect(value.saved).toBe(true);
  expect(value.known).toBe(true);
  expect(value.error).toBeUndefined();
});
it("never sends guest, inactive, missing-selection or stale-generation writes", async () => {
  for (const props of [
    { viewer: null },
    { enabled: false },
    { selected: null },
    { generation: 0 },
  ]) {
    await render(props);
    await toggle();
  }
  expect(h.put).not.toHaveBeenCalled();
  expect(h.get).not.toHaveBeenCalled();
});
it("rejects malformed saved-state data and requires read retry", async () => {
  h.get.mockResolvedValue({ items: [{ targetType: "ip" }] });
  await render();
  expect(value.known).toBe(false);
  await toggle();
  expect(h.put).not.toHaveBeenCalled();
  h.get.mockResolvedValue(saved);
  await act(async () => value.retry());
  expect(value.saved).toBe(true);
});
it("aborts old selection/account reads and ignores their late completion", async () => {
  const d = deferred<unknown>();
  h.get.mockReturnValueOnce(d.promise);
  await render();
  const signal = h.get.mock.calls[0]![1].signal;
  await render({ selected: "other" });
  expect(signal.aborted).toBe(true);
  expect(value.saved).toBe(false);
  await act(async () => d.resolve(saved));
  expect(value.saved).toBe(false);
  h.generation = 2;
  await render({ generation: 2, viewer: "new", locale: "zh-CN" });
  expect(h.get).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ credentials: "include" })
  );
});
it("backgrounding during a write hides state and requires a fresh read on return", async () => {
  await render();
  const d = deferred<unknown>();
  h.put.mockReturnValue(d.promise);
  let operation!: Promise<void>;
  await act(async () => {
    operation = value.toggle();
  });
  const signal = h.put.mock.calls[0]![1].signal;
  await render({ enabled: false });
  expect(signal.aborted).toBe(true);
  expect(value.known).toBe(false);
  await act(async () => {
    d.resolve({});
    await operation;
  });
  expect(h.get).toHaveBeenCalledTimes(1);
  h.get.mockResolvedValue(saved);
  await render();
  expect(value.saved).toBe(true);
  expect(h.get).toHaveBeenCalledTimes(2);
});
