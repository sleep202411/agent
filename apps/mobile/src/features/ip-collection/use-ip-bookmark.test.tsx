import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useIpBookmark } from "./use-ip-bookmark";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const id = "11111111-1111-4111-8111-111111111111";
const saved = { targetType: "ip", status: "active", ip: { id }, episode: null };
let value: ReturnType<typeof useIpBookmark>;
function Probe({
  viewer = "user",
  generation = 1,
  locale = "en-US",
  selected = id,
  enabled = true,
  episode = null,
}: {
  viewer?: string | null;
  generation?: number;
  locale?: string;
  selected?: string | null;
  enabled?: boolean;
  episode?: string | null;
}) {
  const state = useIpBookmark(generation, viewer, locale, selected, enabled, episode);
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
  h.get.mockResolvedValue({ items: [] });
  h.post.mockResolvedValue({});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("reads the official collection and sends explicit bookmark/remove without automatic retry", async () => {
  await render();
  expect(h.get).toHaveBeenCalledWith(
    "/ip-commerce/me/collection",
    expect.objectContaining({
      service: "aurora",
      credentials: "include",
      params: { locale: "en-US" },
      retry: false,
    })
  );
  h.get.mockResolvedValue({ items: [saved] });
  await toggle();
  expect(value.saved).toBe(true);
  expect(h.post).toHaveBeenLastCalledWith(
    "/ip-commerce/me/collection",
    expect.objectContaining({ data: { targetType: "ip", ipId: id }, retry: false })
  );
  h.get.mockResolvedValue({ items: [] });
  await toggle();
  expect(value.saved).toBe(false);
  expect(h.post).toHaveBeenLastCalledWith("/ip-commerce/me/collection/remove", expect.anything());
});
it("does not confuse episode or inactive entries with saved IPs", async () => {
  h.get.mockResolvedValue({
    items: [
      { ...saved, targetType: "episode" },
      { ...saved, status: "removed" },
      { ...saved, episode: { id: "episode" } },
      { ...saved, episodeId: "episode" },
    ],
  });
  await render();
  expect(value.known).toBe(true);
  expect(value.saved).toBe(false);
});
it("serializes taps and reads authoritative state after a lost write reply", async () => {
  await render();
  const d = deferred<unknown>();
  h.post.mockReturnValue(d.promise);
  let operation!: Promise<void>;
  await act(async () => {
    operation = value.toggle();
    void value.toggle();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(value.busy).toBe(true);
  h.get.mockResolvedValue({ items: [saved] });
  await act(async () => {
    d.resolve(Promise.reject(new Error("Write reply lost")));
    await operation;
  });
  expect(value.saved).toBe(true);
  expect(value.error).toBe("Write reply lost");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("blocks another mutation until a failed read is explicitly recovered", async () => {
  await render();
  h.post.mockRejectedValue(new Error("Uncertain write"));
  h.get.mockRejectedValue(new Error("Read denied"));
  await toggle();
  expect(value.known).toBe(false);
  expect(value.error).toContain("Uncertain write");
  expect(value.error).toContain("Read denied");
  await toggle();
  expect(h.post).toHaveBeenCalledTimes(1);
  h.get.mockResolvedValue({ items: [saved] });
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
  expect(h.post).not.toHaveBeenCalled();
  expect(h.get).not.toHaveBeenCalled();
});
it("rejects malformed collection data and requires read retry", async () => {
  h.get.mockResolvedValue({ items: [{ targetType: "ip" }] });
  await render();
  expect(value.known).toBe(false);
  await toggle();
  expect(h.post).not.toHaveBeenCalled();
  h.get.mockResolvedValue({ items: [saved] });
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
  await act(async () => d.resolve({ items: [saved] }));
  expect(value.saved).toBe(false);
  h.generation = 2;
  await render({ generation: 2, viewer: "new", locale: "zh-CN" });
  expect(h.get).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ params: { locale: "zh-CN" } })
  );
});
it("backgrounding during a write hides state and requires a fresh read on return", async () => {
  await render();
  const d = deferred<unknown>();
  h.post.mockReturnValue(d.promise);
  let operation!: Promise<void>;
  await act(async () => {
    operation = value.toggle();
  });
  const signal = h.post.mock.calls[0]![1].signal;
  await render({ enabled: false });
  expect(signal.aborted).toBe(true);
  expect(value.known).toBe(false);
  await act(async () => {
    d.resolve({});
    await operation;
  });
  expect(h.get).toHaveBeenCalledTimes(1);
  h.get.mockResolvedValue({ items: [saved] });
  await render();
  expect(value.saved).toBe(true);
  expect(h.get).toHaveBeenCalledTimes(2);
});

it("bookmarks an episode independently of its parent IP and other episodes", async () => {
  const ep = "22222222-2222-4222-8222-222222222222";
  h.get.mockResolvedValue({
    items: [saved, { ...saved, targetType: "episode", episode: { id: "other" } }],
  });
  await render({ episode: ep });
  expect(value.saved).toBe(false);
  h.get.mockResolvedValue({
    items: [saved, { ...saved, targetType: "episode", episode: { id: ep } }],
  });
  await toggle();
  expect(value.saved).toBe(true);
  expect(h.post).toHaveBeenLastCalledWith(
    "/ip-commerce/me/collection",
    expect.objectContaining({ data: { targetType: "episode", ipId: id, episodeId: ep } })
  );
  h.get.mockResolvedValue({ items: [saved] });
  await toggle();
  expect(value.saved).toBe(false);
  expect(h.post).toHaveBeenLastCalledWith(
    "/ip-commerce/me/collection/remove",
    expect.objectContaining({ data: { targetType: "episode", ipId: id, episodeId: ep } })
  );
  await render();
  expect(value.saved).toBe(true);
});
it("a changed episode hides old state and ignores a late bookmark read", async () => {
  const d = deferred<unknown>();
  h.get.mockReturnValueOnce(d.promise);
  await render({ episode: "first" });
  const signal = h.get.mock.calls[0]![1].signal;
  await render({ episode: "second" });
  expect(signal.aborted).toBe(true);
  await act(async () =>
    d.resolve({ items: [{ ...saved, targetType: "episode", episodeId: "first" }] })
  );
  expect(value.saved).toBe(false);
});
