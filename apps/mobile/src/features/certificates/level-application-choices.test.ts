import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  applicationAssociationLink,
  fetchApplicationCrews,
  fetchApplicationIps,
} from "./level-application-choices";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("combines founded and joined Crews without duplicates", async () => {
  vi.mocked(api.get).mockResolvedValue({
    founded: [{ id: "crew", name: "Crew" }],
    joined: [
      { id: "crew", name: "Crew" },
      { id: "a", name: "A" },
    ],
  });
  expect((await fetchApplicationCrews(1, signal())).map((v) => v.id)).toEqual(["a", "crew"]);
});
it("does not hide a directory failure as no Crews", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("Permission denied"));
  await expect(fetchApplicationCrews(1, signal())).rejects.toThrow("Permission denied");
});
it("loads every owned IP page and preserves public room numbers", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({
      items: [{ id: "internal-1", title: "B", roomNumber: "12345678" }],
      nextCursor: "internal-1",
    })
    .mockResolvedValueOnce({
      items: [{ id: "internal-2", title: "A", roomNumber: "87654321" }],
      nextCursor: null,
    });
  expect(await fetchApplicationIps("en-US", 1, signal())).toEqual([
    { id: "internal-2", title: "A", roomNumber: "87654321" },
    { id: "internal-1", title: "B", roomNumber: "12345678" },
  ]);
  expect(api.get).toHaveBeenLastCalledWith(
    "/ip-commerce/me/ips",
    expect.objectContaining({
      params: { locale: "en-US", limit: 50, cursor: "internal-1" },
      retry: false,
    })
  );
});
it("rejects cursor cycles without returning a partial directory", async () => {
  vi.mocked(api.get).mockResolvedValue({
    items: [{ id: "one", title: "A", roomNumber: "123" }],
    nextCursor: "one",
  });
  await expect(fetchApplicationIps("en-US", 1, signal())).rejects.toThrow("cursor");
  expect(api.get).toHaveBeenCalledTimes(2);
});
it("discards another account's IP page before requesting the next one", async () => {
  vi.mocked(api.get).mockImplementation(async () => {
    h.generation = 2;
    return { items: [], nextCursor: null };
  });
  await expect(fetchApplicationIps("en-US", 1, signal())).rejects.toThrow("session");
});
it("does not access either directory after cancellation", async () => {
  const c = new AbortController();
  c.abort();
  await expect(fetchApplicationCrews(1, c.signal)).rejects.toThrow("cancelled");
  await expect(fetchApplicationIps("en-US", 1, c.signal)).rejects.toThrow("cancelled");
  expect(api.get).not.toHaveBeenCalled();
});
it("builds regional localized public links and rejects path injection", () => {
  expect(applicationAssociationLink("ip", "12345678", "cn", "zh-CN")).toBe(
    "https://fizzdragon.fizzspace.cn/zh-CN/ip/12345678"
  );
  expect(applicationAssociationLink("crews", "crew", "global", "en-US")).toBe(
    "https://fizzdragon.com/en-US/crews/crew"
  );
  expect(() => applicationAssociationLink("ip", "../admin", "global", "en-US")).toThrow();
});
