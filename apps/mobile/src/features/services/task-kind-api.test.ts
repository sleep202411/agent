import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchTaskKindTemplates } from "./task-kind-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "storyboard",
  name: "Shots",
  title: "Create storyboard",
  description: "Details",
};
beforeEach(() => vi.resetAllMocks());
it("loads the Crew template catalog in server order", async () => {
  const signal = new AbortController().signal;
  const second = { ...row, id: "22222222-2222-4222-8222-222222222222", title: "Second" };
  vi.mocked(api.get).mockResolvedValue({ items: [row, second] });
  expect(await fetchTaskKindTemplates("crew", signal)).toEqual([row, second]);
  expect(api.get).toHaveBeenCalledExactlyOnceWith("/crews/crew/task-kind-templates", {
    service: "aurora",
    signal,
  });
});
it("rejects malformed kinds, duplicate IDs and oversized draft content", async () => {
  for (const items of [
    [{ ...row, kind: "unknown" }],
    [row, row],
    [{ ...row, title: "x".repeat(181) }],
    [{ ...row, description: "x".repeat(10001) }],
  ]) {
    vi.mocked(api.get).mockResolvedValue({ items });
    await expect(fetchTaskKindTemplates("crew", new AbortController().signal)).rejects.toThrow();
  }
});
it("distinguishes an empty catalog from a loading failure", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [] });
  expect(await fetchTaskKindTemplates("crew", new AbortController().signal)).toEqual([]);
  vi.mocked(api.get).mockRejectedValue(new Error("Forbidden"));
  await expect(fetchTaskKindTemplates("crew", new AbortController().signal)).rejects.toThrow(
    "Forbidden"
  );
});
