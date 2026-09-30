import { beforeEach, expect, it, vi } from "vitest";
import { activityDetails, fetchActivityAuthors } from "./project-activity-display";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("batches unique numeric identities in groups of at most 50", async () => {
  h.get.mockImplementation(async (_path, options) => ({
    users: options.params.ids
      .split(",")
      .map((userId: string) => ({ userId, nickname: `Artist ${userId}` })),
  }));
  const names = await fetchActivityAuthors(
    [...Array.from({ length: 51 }, (_, i) => String(i + 1)), "1", "invalid"],
    1,
    new AbortController().signal
  );
  expect(Object.keys(names)).toHaveLength(51);
  expect(h.get).toHaveBeenCalledTimes(2);
  expect(h.get.mock.calls[1]?.[1].params.ids).toBe("51");
});
it("rejects unrequested identities and stale account results", async () => {
  h.get.mockResolvedValue({ users: [{ userId: "2", nickname: "Other" }] });
  await expect(fetchActivityAuthors(["1"], 1, new AbortController().signal)).rejects.toThrow(
    "scope"
  );
  h.get.mockImplementation(async () => {
    h.generation++;
    return { users: [{ userId: "1", nickname: "Old" }] };
  });
  await expect(fetchActivityAuthors(["1"], 1, new AbortController().signal)).rejects.toThrow(
    "expired"
  );
});
it("leaves missing or blank names unresolved", async () => {
  h.get.mockResolvedValue({ users: [{ userId: "1", nickname: " " }] });
  expect(await fetchActivityAuthors(["1", "2"], 1, new AbortController().signal)).toEqual({});
});
it("renders known property changes and omits unrelated metadata", () => {
  expect(
    activityDetails({
      kind: "properties_changed",
      payload: {
        changes: [
          { field: "status", from: "planned", to: "in_progress" },
          { field: "start_date", from: null, to: "2026-09-30" },
          { field: "secret", from: null, to: "hidden" },
        ],
        token: "private",
      },
    })
  ).toEqual([
    { key: "field.status", value: "planned → in_progress" },
    { key: "field.start_date", value: "— → 2026-09-30" },
  ]);
});
it("renders label and resource names without exposing raw payloads", () => {
  expect(
    activityDetails({
      kind: "labels_changed",
      payload: { added: [{ name: "Review" }, null], removed: [{ name: "Draft" }] },
    })
  ).toEqual([
    { key: "added", value: "Review" },
    { key: "removed", value: "Draft" },
  ]);
  expect(
    activityDetails({
      kind: "resource_removed",
      payload: { resource: { title: "Script", url: "private" } },
    })
  ).toEqual([{ key: "resource", value: "Script" }]);
  expect(activityDetails({ kind: "properties_changed", payload: null })).toEqual([]);
});
it("localizes known property values while preserving dates and identifiers", () => {
  expect(
    activityDetails(
      {
        kind: "properties_changed",
        payload: {
          changes: [
            { field: "status", from: "planned", to: "completed" },
            { field: "start_date", from: null, to: "2026-09-30" },
          ],
        },
      },
      (key) => `translated:${key}`
    )
  ).toEqual([
    {
      key: "field.status",
      value: "translated:projectProperties.planned → translated:projectProperties.completed",
    },
    { key: "field.start_date", value: "— → 2026-09-30" },
  ]);
});
