import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ipCommerceKeys,
  useIpCommerceIp,
  usePurchaseIpContent,
  useToggleIpEngagementLike,
} from "./hooks";
import { ipRoomPath } from "./urls";
import { toCanonicalIpId } from "../ip-id";
import RoomPage from "@/app/(site)/ip/[roomNumber]/page";
import LegacyPage from "@/app/(site)/ips/[id]/page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("@/src/lib/api", () => ({ api }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-locale": "zh-CN" }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("404");
  },
  permanentRedirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/app/(site)/ips/[id]/_components/ip-public-detail", () => ({
  IpPublicDetail: () => null,
}));

const id = "00000000-0000-4000-8000-000000000001";
const roomNumber = "100001";
const initialIp = { id, roomNumber, title: "Room test", viewerHasLiked: false };
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

function Harness() {
  const query = useIpCommerceIp(roomNumber);
  const like = useToggleIpEngagementLike();
  const purchase = usePurchaseIpContent();
  return (
    <>
      <span>{query.data?.ip.title}</span>
      <button onClick={() => like.mutate({ ipId: query.data!.ip.id, viewerHasLiked: false })}>
        Like
      </button>
      <button
        onClick={() =>
          purchase.mutate({
            ipId: query.data!.ip.id,
            targetType: "ip",
            idempotencyKey: "room-purchase-test",
          })
        }
      >
        Buy
      </button>
    </>
  );
}

it("opens room URLs without going through the old Java ID conversion", async () => {
  const page = await RoomPage({ params: Promise.resolve({ roomNumber }) });
  expect(page.props.ipReference).toBe(roomNumber);
  expect(ipRoomPath(roomNumber)).toBe("/ip/100001");
  await expect(LegacyPage({ params: Promise.resolve({ id: roomNumber }) })).rejects.toThrow(
    `redirect:/zh-CN/ips/${toCanonicalIpId(roomNumber)}`
  );
  expect((await LegacyPage({ params: Promise.resolve({ id }) })).props.ipReference).toBe(id);
  for (const invalid of ["0", "0100001", "1e6", "abc", "1".repeat(20)]) {
    await expect(RoomPage({ params: Promise.resolve({ roomNumber: invalid }) })).rejects.toThrow(
      "404"
    );
  }
});

it("refreshes both room and UUID detail caches after likes and purchases", async () => {
  client.setQueryData(ipCommerceKeys.ip(id), { ip: initialIp });
  client.setQueryData(ipCommerceKeys.ip(roomNumber), { ip: initialIp });
  client.setQueryData(ipCommerceKeys.ip("100002"), { ip: { id: "other", roomNumber: "100002" } });
  api.get.mockResolvedValue({ ip: initialIp });
  const engagement = { viewCount: 1, likeCount: 1, collectionCount: 0, viewerHasLiked: true };
  api.put.mockResolvedValue({ engagement });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    )
  );
  await act(async () => container.querySelectorAll("button")[0].click());
  await vi.waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(`/aurora/ip-commerce/ips/${roomNumber}`, {
      params: undefined,
    })
  );
  expect(api.put).toHaveBeenCalledWith(`/aurora/ip-commerce/ips/${id}/like`);
  expect(
    client.getQueryData<{ ip: { engagement: unknown } }>(ipCommerceKeys.ip(id))?.ip.engagement
  ).toEqual(engagement);
  expect(client.getQueryState(ipCommerceKeys.ip(id))?.isInvalidated).toBe(true);
  expect(client.getQueryState(ipCommerceKeys.ip("100002"))?.isInvalidated).toBe(false);

  api.get.mockClear().mockResolvedValue({ ip: { ...initialIp, title: "Unlocked" } });
  api.post.mockResolvedValue({ alreadyOwned: false, entitlements: [] });
  await act(async () => container.querySelectorAll("button")[1].click());
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Unlocked");
  });
  expect(api.post).toHaveBeenLastCalledWith("/aurora/ip-commerce/purchases", {
    data: { ipId: id, targetType: "ip", idempotencyKey: "room-purchase-test" },
  });
  expect(api.get).toHaveBeenCalledWith(`/aurora/ip-commerce/ips/${roomNumber}`, {
    params: undefined,
  });
});
