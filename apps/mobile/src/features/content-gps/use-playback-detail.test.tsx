import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EpisodeAccess, IpAccess, IpDetail } from "@/data/types";
import { usePlaybackDetail } from "./use-playback-detail";
const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./load-playback-detail", () => ({ loadPlaybackDetail: h.load }));
const detail = {
  id: "ip",
  title: "Story",
  episodes: [{ id: "ep", title: "First", mediaUrl: "full.mp4" }],
} as IpDetail;
const access = (code: EpisodeAccess = "free"): IpAccess => ({
  authenticated: true,
  member: false,
  balance: "100",
  ip: { owned: false, access: "free", price: null },
  episodes: { ep: { owned: false, access: code, price: null } },
});
const result = (code: EpisodeAccess = "free") => ({
  detail,
  access: access(code),
  accessError: null,
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let current: ReturnType<typeof usePlaybackDetail>;
function Screen({ active = true }: { active?: boolean }) {
  const value = usePlaybackDetail("ip", "1", "ep", active);
  useLayoutEffect(() => {
    current = value;
  });
  return null;
}
const render = (active = true, key = "viewer") =>
  act(async () => root.render(<Screen key={key} active={active} />));
beforeEach(() => {
  vi.resetAllMocks();
  root = createRoot(document.createElement("div"));
  h.load.mockResolvedValue(result());
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("clears playback/access on blur and checks fresh entitlement on return", async () => {
  await render();
  expect(current.playing?.url).toBe("full.mp4");
  const version = current.revision.current;
  await render(false);
  expect(current.playing).toBeUndefined();
  expect(current.access).toBeUndefined();
  expect(current.isCurrent(version)).toBe(false);
  h.load.mockResolvedValue(result("locked"));
  await render();
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(current.ip).toBe(detail);
  expect(current.access?.episodes.ep?.access).toBe("locked");
  expect(current.playing).toBeUndefined();
  expect(current.isCurrent(version)).toBe(false);
});
it("ignores a slow pre-blur reply after a new foreground check", async () => {
  let finish!: (value: ReturnType<typeof result>) => void;
  h.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await render(false);
  h.load.mockResolvedValue(result("locked"));
  await render();
  await act(async () => finish(result()));
  expect(current.access?.episodes.ep?.access).toBe("locked");
  expect(current.playing).toBeUndefined();
});
it("keeps public context on return failure and supports explicit recovery", async () => {
  await render();
  await render(false);
  h.load.mockRejectedValueOnce(new Error("Access service unavailable"));
  await render();
  expect(current.ip).toBe(detail);
  expect(current.access).toBeUndefined();
  expect(current.playing).toBeUndefined();
  expect(current.accessError).toBe("Access service unavailable");
  expect(current.accessBusy).toBe(false);
  await act(async () => {
    await current.refresh(true);
  });
  expect(current.accessError).toBeNull();
  expect(current.playing?.url).toBe("full.mp4");
});
it("ignores older read completions and invalidates their confirmation versions", async () => {
  await render();
  const original = current.revision.current;
  let finish!: (value: ReturnType<typeof result>) => void;
  h.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  let old!: ReturnType<typeof current.refresh>;
  await act(async () => {
    old = current.refresh(true);
  });
  expect(current.isCurrent(original)).toBe(false);
  h.load.mockResolvedValue(result("locked"));
  await act(async () => {
    await current.refresh(true);
  });
  await act(async () => finish(result()));
  expect(await old).toBeUndefined();
  expect(current.access?.episodes.ep?.access).toBe("locked");
  expect(current.playing).toBeUndefined();
});
it("cannot apply the previous viewer's reply after a keyed session replacement", async () => {
  let finish!: (value: ReturnType<typeof result>) => void;
  h.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const old = current;
  h.load.mockResolvedValue(result("locked"));
  await render(true, "other-viewer");
  await act(async () => finish(result()));
  expect(old.aliveRef.current).toBe(false);
  expect(current.access?.episodes.ep?.access).toBe("locked");
  expect(current.playing).toBeUndefined();
});
it("does not start hidden reads and recovers an initial detail failure", async () => {
  await render(false);
  expect(h.load).not.toHaveBeenCalled();
  await act(async () => {
    expect(await current.refresh()).toBeUndefined();
  });
  h.load.mockRejectedValueOnce(new Error("Detail unavailable"));
  await render();
  expect(current.loading).toBe(false);
  expect(current.ip).toBeUndefined();
  expect(current.accessError).toBe("Detail unavailable");
  await act(async () => {
    await current.refresh(true);
  });
  expect(current.ip).toBe(detail);
});
