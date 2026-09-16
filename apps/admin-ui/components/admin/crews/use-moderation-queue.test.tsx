// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { useModerationQueue } from "./use-moderation-queue";
const api = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../billing/shared", () => ({
  requestEnvelope: api.read,
  mutateEnvelope: api.write,
  toErrorMessage: (e: Error) => e.message,
}));
type Row = { id: string; moderationStatus: string };
let current: ReturnType<typeof useModerationQueue<Row>>;
let root: Root;
function View({ query }: { query: string }) {
  const result = useModerationQueue<Row>("/api/admin/crews", query, "");
  useLayoutEffect(() => {
    current = result;
  });
  return null;
}
async function render(query: string) {
  await act(async () =>
    root.render(
      <AdminSessionBoundary scopeKey="admin">
        <View query={query} />
      </AdminSessionBoundary>
    )
  );
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  api.write.mockResolvedValue({ id: "old", moderationStatus: "ok" });
  root = createRoot(document.createElement("div"));
  api.read.mockImplementation(async (url: string) => ({
    items: [{ id: url.includes("q=new") ? "new" : "old", moderationStatus: "ok" }],
    nextCursor: null,
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it.each([false, true])(
  "loads the replacement filter after a pending mutation settles (failure: %s)",
  async (failure) => {
    let resolve!: (row: Row) => void;
    let reject!: (error: Error) => void;
    api.write.mockImplementation(
      () =>
        new Promise<Row>((yes, no) => {
          resolve = yes;
          reject = no;
        })
    );
    await render("old");
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = current.moderate(current.items[0]!, "ok");
    });
    await render("new");
    await act(async () => {
      if (failure) reject(new Error("old failure"));
      else resolve({ id: "old", moderationStatus: "ok" });
      await pending;
    });
    expect(current.items.map((row) => row.id)).toEqual(["new"]);
    expect(current.error).toBe(null);
    expect(current.acting).toBe(false);
  }
);
it("does not run a retained action after the filter changes", async () => {
  await render("old");
  const oldModerate = current.moderate;
  await render("new");
  await act(async () => {
    await oldModerate({ id: "old", moderationStatus: "ok" }, "ok");
  });
  expect(api.write).not.toHaveBeenCalled();
});

it("keeps successful moderation and required-reason validation in the active filter", async () => {
  await render("old");
  await act(async () => {
    expect(await current.moderate(current.items[0]!, "taken_down")).toBe(false);
  });
  expect(api.write).not.toHaveBeenCalled();
  api.write.mockResolvedValue({ id: "old", moderationStatus: "taken_down" });
  await act(async () => {
    expect(await current.moderate(current.items[0]!, "taken_down", "reviewed reason")).toBe(true);
  });
  expect(current.items).toEqual([{ id: "old", moderationStatus: "taken_down" }]);
  expect(current.acting).toBe(false);
  expect(api.read).toHaveBeenCalledTimes(1);
});
