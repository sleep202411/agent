import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useIpCommerceIp,
  useToggleIpEngagementLike,
  useRecordIpView,
  ipCommerceKeys,
} from "./hooks";
const state = vi.hoisted(() => ({
  userId: "alice",
  detail: vi.fn(),
  like: vi.fn(),
  view: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.userId ? { id: state.userId } : null }),
}));
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  getIpCommerceIp: state.detail,
  likeIpContent: state.like,
  recordIpView: state.view,
}));
let client: QueryClient;
const host = document.createElement("div");
let root = createRoot(host);
let detail: ReturnType<typeof useIpCommerceIp>;
let like: ReturnType<typeof useToggleIpEngagementLike>;
let view: ReturnType<typeof useRecordIpView>;
function View() {
  const d = useIpCommerceIp("ip");
  const l = useToggleIpEngagementLike();
  const v = useRecordIpView();
  useLayoutEffect(() => {
    detail = d;
    like = l;
    view = v;
  });
  return null;
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <View />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.userId = "alice";
  state.detail.mockImplementation(() =>
    Promise.resolve({ ip: { id: "ip", viewerHasLiked: false } })
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  client.clear();
  vi.resetAllMocks();
});
it.each(["like", "view"])(
  "does not apply delayed %s engagement to the replacement viewer",
  async (kind) => {
    let finish!: (value: unknown) => void;
    state[kind === "like" ? "like" : "view"].mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await render();
    let mutation!: Promise<unknown>;
    await act(async () => {
      mutation =
        kind === "like"
          ? like.mutateAsync({ ipId: "ip", viewerHasLiked: false })
          : view.mutateAsync({ ipId: "ip" });
    });
    state.userId = "bob";
    await render();
    await act(async () => {
      finish({
        engagement: { viewerHasLiked: true, viewCount: 2, likeCount: 1, collectionCount: 0 },
      });
      await mutation;
    });
    expect(detail.data?.ip.viewerHasLiked).toBe(false);
    const old = client.getQueryData<{ ip: { viewerHasLiked: boolean } }>([
      ...ipCommerceKeys.ip("ip"),
      "alice",
    ]);
    expect(old?.ip.viewerHasLiked).toBe(true);
  }
);
it("separates guest detail and aborts a previous viewer's pending read", async () => {
  state.detail.mockImplementationOnce(() => new Promise(() => {}));
  await render();
  const signal = state.detail.mock.calls[0]![2] as AbortSignal;
  state.userId = "";
  await render();
  expect(signal.aborted).toBe(true);
  expect(state.detail).toHaveBeenCalledTimes(2);
  expect(detail.data?.ip.id).toBe("ip");
});
