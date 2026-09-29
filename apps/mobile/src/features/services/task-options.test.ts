import { beforeEach, expect, it, vi } from "vitest";
import { fetchTaskOptions, taskLabel } from "./task-options";
import { api } from "@/lib/api-client";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => vi.resetAllMocks());
it("uses scoped server search and cursor without silently filtering active tasks", async () => {
  vi.mocked(api.get).mockResolvedValue({
    items: [{ id, number: 7, title: "Scene" }],
    nextCursor: null,
  });
  const signal = new AbortController().signal;
  await expect(fetchTaskOptions("crew", { query: " scene " }, id, signal)).resolves.toMatchObject({
    items: [{ id }],
    nextCursor: null,
  });
  expect(api.get).toHaveBeenCalledWith("/crews/crew/task-options", {
    service: "aurora",
    signal,
    params: { query: "scene", limit: 30, cursor: id },
  });
});
it("rejects overlong search and invalid task IDs/cursors", async () => {
  await expect(
    fetchTaskOptions("crew", { query: "x".repeat(181) }, null, new AbortController().signal)
  ).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
  vi.mocked(api.get).mockResolvedValue({
    items: [{ id: "invalid", number: 1, title: "Scene" }],
    nextCursor: null,
  });
  await expect(fetchTaskOptions("crew", {}, null, new AbortController().signal)).rejects.toThrow();
});
it("builds bounded task tokens without forbidden label characters", () => {
  expect(taskLabel({ id, number: 7, title: "Scene #1\nNext" })).toBe("TASK-7 Scene  1 Next");
});

it("requests recruitment eligibility only when selected by the caller", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [], nextCursor: null });
  await fetchTaskOptions(
    "crew",
    { query: "shot", recruitmentOnly: true },
    null,
    new AbortController().signal
  );
  expect(api.get).toHaveBeenCalledWith(
    "/crews/crew/task-options",
    expect.objectContaining({ params: { query: "shot", limit: 30, recruitmentOnly: "true" } })
  );
});
