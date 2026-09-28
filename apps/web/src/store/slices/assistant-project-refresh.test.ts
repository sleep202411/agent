import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/src/lib/api", () => ({ backendApi: { post: mock.post }, api: { post: mock.post } }));
import { refreshProjectDetail } from "./assistantSlice";
import type { AppDispatch } from "@/src/store";
let dispatch: AppDispatch;
const reads: { resolve: (value: { id: string; name: string }) => void }[] = [];
beforeEach(() => {
  dispatch = vi.fn() as unknown as AppDispatch;
  reads.length = 0;
  mock.post.mockReset().mockImplementation(() => new Promise((resolve) => reads.push({ resolve })));
});
it("does not apply detail after the originating view is abandoned", async () => {
  let active = true;
  const run = refreshProjectDetail(dispatch, "first", { isCurrent: () => active });
  active = false;
  reads[0]!.resolve({ id: "first", name: "Old" });
  await run;
  expect(dispatch).not.toHaveBeenCalled();
});
it("keeps the latest refresh when responses arrive out of order", async () => {
  const options = { isCurrent: () => true };
  const first = refreshProjectDetail(dispatch, "same", options);
  const second = refreshProjectDetail(dispatch, "same", options);
  reads[1]!.resolve({ id: "same", name: "New" });
  await second;
  reads[0]!.resolve({ id: "same", name: "Old" });
  await first;
  expect(dispatch).toHaveBeenCalledOnce();
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ payload: { id: "same", name: "New" } })
  );
});
it("does not start a refresh for a background project", async () => {
  await refreshProjectDetail(dispatch, "background", { isCurrent: () => false });
  expect(mock.post).not.toHaveBeenCalled();
});
it("ignores completion after session cancellation", async () => {
  const controller = new AbortController();
  const run = refreshProjectDetail(dispatch, "first", {
    isCurrent: () => true,
    signal: controller.signal,
  });
  expect(mock.post).toHaveBeenCalledWith("/api/user/project/detail/first", {
    signal: controller.signal,
  });
  controller.abort();
  reads[0]!.resolve({ id: "first", name: "Old" });
  await run;
  expect(dispatch).not.toHaveBeenCalled();
});
it("allows a fresh retry after an active request fails", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mock.post.mockRejectedValueOnce(new Error("offline"));
    await refreshProjectDetail(dispatch, "first", { isCurrent: () => true });
    expect(error).toHaveBeenCalledOnce();
    const retry = refreshProjectDetail(dispatch, "first", { isCurrent: () => true });
    reads[0]!.resolve({ id: "first", name: "Recovered" });
    await retry;
    expect(dispatch).toHaveBeenCalledOnce();
  } finally {
    error.mockRestore();
  }
});
