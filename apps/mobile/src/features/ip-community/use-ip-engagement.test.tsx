import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { IpEngagementSnapshot } from "@/data/types";
import { useIpEngagement } from "./use-ip-engagement";
const h = vi.hoisted(() => ({
  like: vi.fn(),
  unlike: vi.fn(),
  view: vi.fn(),
  apply: vi.fn(),
  refresh: vi.fn(),
  fail: vi.fn(),
  login: vi.fn(),
  openLogin: vi.fn(),
  invalidate: vi.fn(),
  generation: 1,
  authenticated: true,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    generation: h.generation,
    status: h.authenticated ? "authenticated" : "anonymous",
  }),
  useAuthGate: () => ({ requireAuth: h.login, openLogin: h.openLogin }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/data/browse-service", () => ({
  likeIp: h.like,
  unlikeIp: h.unlike,
  recordIpView: h.view,
}));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: h.invalidate }));
vi.mock("@/lib/api-client", () => ({
  ApiRequestError: class extends Error {
    status = 401;
  },
}));
const snapshot = (liked = true): IpEngagementSnapshot => ({
  viewCount: 12,
  likeCount: liked ? 5 : 4,
  viewerHasLiked: liked,
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, current: ReturnType<typeof useIpEngagement>;
function Screen({ active = true, liked = false }: { active?: boolean; liked?: boolean }) {
  const value = useIpEngagement(
    { id: "ip", viewerHasLiked: liked },
    active,
    h.apply,
    h.refresh,
    h.fail
  );
  useLayoutEffect(() => {
    current = value;
  });
  return null;
}
const render = (active = true, liked = false, key = "viewer") =>
  act(async () => root.render(<Screen key={key} active={active} liked={liked} />));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.authenticated = true;
  h.view.mockResolvedValue(undefined);
  h.like.mockResolvedValue(snapshot());
  h.unlike.mockResolvedValue(snapshot(false));
  h.refresh.mockResolvedValue(undefined);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("returns guests to fresh detail without retaining a guest mutation callback", async () => {
  h.authenticated = false;
  await render();
  await act(async () => current.toggle());
  expect(h.login).toHaveBeenCalledExactlyOnceWith();
  expect(h.like).not.toHaveBeenCalled();
  h.authenticated = true;
  h.generation++;
  await render(true, true, "signed-in");
  await act(async () => current.toggle());
  expect(h.unlike).toHaveBeenCalledExactlyOnceWith("ip");
  expect(h.like).not.toHaveBeenCalled();
});
it("serializes repeated taps and rejects a delayed pre-like view snapshot", async () => {
  let view!: (v: IpEngagementSnapshot) => void, like!: (v: IpEngagementSnapshot) => void;
  h.view.mockImplementationOnce(
    () =>
      new Promise((r) => {
        view = r;
      })
  );
  h.like.mockImplementationOnce(
    () =>
      new Promise((r) => {
        like = r;
      })
  );
  await render();
  await act(async () => {
    void current.toggle();
    void current.toggle();
  });
  expect(h.like).toHaveBeenCalledTimes(1);
  expect(current.busy).toBe(true);
  await act(async () => like(snapshot()));
  await act(async () => view(snapshot(false)));
  expect(h.apply).toHaveBeenCalledExactlyOnceWith("ip", snapshot());
  expect(current.busy).toBe(false);
});
it("keeps playback intact on normal success and refreshes only a missing snapshot", async () => {
  await render();
  h.apply.mockClear();
  await act(async () => current.toggle());
  expect(h.refresh).not.toHaveBeenCalled();
  h.like.mockResolvedValue(undefined);
  await act(async () => current.toggle());
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("reconciles a write finishing after return without applying its old snapshot", async () => {
  let done!: (v: IpEngagementSnapshot) => void;
  h.like.mockImplementationOnce(
    () =>
      new Promise((r) => {
        done = r;
      })
  );
  await render();
  h.apply.mockClear();
  await act(async () => {
    void current.toggle();
  });
  await render(false);
  await render();
  await act(async () => done(snapshot()));
  expect(h.apply).not.toHaveBeenCalled();
  expect(h.refresh).toHaveBeenCalledOnce();
  expect(current.busy).toBe(false);
});
it("does not leave the button busy after a background completion or affect another account", async () => {
  let done!: (v: IpEngagementSnapshot) => void;
  h.like.mockImplementationOnce(
    () =>
      new Promise((r) => {
        done = r;
      })
  );
  await render();
  await act(async () => {
    void current.toggle();
  });
  await render(false);
  await act(async () => done(snapshot()));
  await render();
  expect(current.busy).toBe(false);
  h.like.mockImplementationOnce(
    () =>
      new Promise((r) => {
        done = r;
      })
  );
  await act(async () => {
    void current.toggle();
  });
  h.generation++;
  await render(true, false, "other");
  h.apply.mockClear();
  await act(async () => done(snapshot()));
  expect(h.apply).not.toHaveBeenCalled();
  expect(h.refresh).not.toHaveBeenCalled();
});
it("surfaces the current server error and allows a deliberate retry", async () => {
  const error = new Error("This IP cannot be liked");
  h.like.mockRejectedValueOnce(error);
  await render();
  await act(async () => current.toggle());
  expect(h.fail).toHaveBeenCalledWith(error);
  expect(current.busy).toBe(false);
  await act(async () => current.toggle());
  expect(h.like).toHaveBeenCalledTimes(2);
});
