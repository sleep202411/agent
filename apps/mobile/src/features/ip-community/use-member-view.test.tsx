import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useMemberView } from "./use-member-view";
const h = vi.hoisted(() => ({ post: vi.fn(), generation: 1, current: 1, status: "authenticated" }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
vi.mock("@/auth", () => ({
  useAuth: () => ({ generation: h.generation, status: h.status, user: { id: "viewer" } }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.current }));
function Probe({
  playing,
  episode,
}: {
  playing: boolean;
  episode?: { ipId: string; episodeId: string };
}) {
  useMemberView(episode, playing);
  return null;
}
let root: Root;
const episode = { ipId: "ip", episodeId: "episode-4" };
const render = (playing = true, target: typeof episode | undefined = episode) =>
  act(async () => {
    root.render(<Probe playing={playing} episode={target} />);
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.generation = h.current = 1;
  h.status = "authenticated";
  h.post.mockReset().mockResolvedValue({ recorded: true });
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));
it("records full episode playback through the official endpoint and dedupes resumes", async () => {
  await render();
  expect(h.post).toHaveBeenCalledWith("/ip-commerce/member-views", {
    service: "aurora",
    data: episode,
    signal: expect.any(AbortSignal),
    retry: false,
  });
  await render(false);
  await render();
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("does not signal a trailer or paused player", async () => {
  await act(async () => root.render(<Probe playing />));
  await render(false);
  expect(h.post).not.toHaveBeenCalled();
});
it("does not signal guests or stale account generations", async () => {
  h.status = "anonymous";
  await render();
  h.status = "authenticated";
  h.current = 2;
  await render();
  expect(h.post).not.toHaveBeenCalled();
});
it.each([false, true])(
  "allows a later playback retry after ineligible or failed signal (%s)",
  async (failure) => {
    if (failure) h.post.mockRejectedValueOnce(new Error("Offline"));
    else h.post.mockResolvedValueOnce({ recorded: false });
    await render();
    await render();
    expect(h.post).toHaveBeenCalledTimes(1);
    await render(false);
    await render();
    expect(h.post).toHaveBeenCalledTimes(2);
  }
);
it("aborts retired playback and separates account and episode signals", async () => {
  await render();
  const signal = h.post.mock.calls[0][1].signal as AbortSignal;
  await render(false);
  expect(signal.aborted).toBe(true);
  h.generation = h.current = 2;
  await render();
  await render(true, { ipId: "ip", episodeId: "episode-5" });
  expect(h.post).toHaveBeenCalledTimes(3);
});
it("reports playback again in a new UTC settlement month", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-31T23:59:59Z"));
    await render();
    await render(false);
    vi.setSystemTime(new Date("2026-11-01T00:00:01Z"));
    await render();
    expect(h.post).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
