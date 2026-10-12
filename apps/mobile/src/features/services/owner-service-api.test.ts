import { expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchOwnedServices, changeServiceStatus, serviceActions } from "./owner-service-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
it("uses owner filters and rejects foreign/malformed rows", async () => {
  const signal = new AbortController().signal;
  const item = { id: "s", creatorId: "1", title: "Film", summary: "Editing" };
  vi.mocked(api.get).mockResolvedValue({ items: [item], nextCursor: null });
  expect((await fetchOwnedServices("1", "draft", "next", signal)).items).toEqual([item]);
  expect(api.get).toHaveBeenLastCalledWith("/creator-services", {
    service: "aurora",
    signal,
    params: { creatorId: "1", status: "draft", cursor: "next", limit: 24 },
  });
  await expect(fetchOwnedServices("2", "", null, signal)).rejects.toThrow("owner mismatch");
  vi.mocked(api.get).mockResolvedValue({ items: [{}], nextCursor: null });
  await expect(fetchOwnedServices("1", "", null, signal)).rejects.toThrow();
});
it("offers the supported transitions and uses explicit verb routes", async () => {
  expect(serviceActions("draft")).toEqual(["publish", "archive"]);
  expect(serviceActions("listed")).toEqual(["pause", "archive"]);
  expect(serviceActions("paused")).toEqual(["resume", "archive"]);
  expect(serviceActions("archived")).toEqual([]);
  for (const action of ["publish", "pause", "resume"] as const) {
    await changeServiceStatus("a/b", action);
    expect(api.post).toHaveBeenLastCalledWith(`/creator-services/a%2Fb/${action}`, {
      service: "aurora",
    });
  }
  await changeServiceStatus("a/b", "archive");
  expect(api.delete).toHaveBeenLastCalledWith("/creator-services/a%2Fb", { service: "aurora" });
});
