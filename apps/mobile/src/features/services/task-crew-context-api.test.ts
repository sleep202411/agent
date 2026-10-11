import { beforeEach, expect, it, vi } from "vitest";
import { appendTaskContext, fetchTaskCrewIntroduction } from "./task-crew-context-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("appends without replacing existing task text or silently truncating", () => {
  expect(appendTaskContext("Draft", "Crew context")).toBe("Draft\n\nCrew context");
  expect(appendTaskContext("", "Creator")).toBe("Creator");
  expect(() => appendTaskContext("a".repeat(10000), "x")).toThrow("10,000");
});
it("loads the exact Crew introduction without mutating anything", async () => {
  h.get.mockResolvedValue({ id: "crew", description: "Introduction" });
  expect(await fetchTaskCrewIntroduction("crew", 1, new AbortController().signal)).toBe(
    "Introduction"
  );
  expect(h.get).toHaveBeenCalledWith("/crews/crew", expect.objectContaining({ retry: false }));
});
it("preserves empty introductions and rejects mismatched receipts", async () => {
  h.get.mockResolvedValue({ id: "crew", description: null });
  expect(await fetchTaskCrewIntroduction("crew", 1, new AbortController().signal)).toBe("");
  h.get.mockResolvedValue({ id: "other", description: "Wrong" });
  await expect(fetchTaskCrewIntroduction("crew", 1, new AbortController().signal)).rejects.toThrow(
    "changed"
  );
});
it("rejects unsafe IDs and late responses from an old account", async () => {
  await expect(
    fetchTaskCrewIntroduction("../bad", 1, new AbortController().signal)
  ).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
  h.get.mockImplementation(async () => {
    h.generation++;
    return { id: "crew", description: "Old" };
  });
  await expect(fetchTaskCrewIntroduction("crew", 1, new AbortController().signal)).rejects.toThrow(
    "expired"
  );
});
