// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { useDiscoverySave } from "./use-discovery-save";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let result: ReturnType<typeof useDiscoverySave>;
const request = vi.fn<(signal: AbortSignal) => Promise<void>>();
const saved = vi.fn();
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function View({ open }: { open: boolean }) {
  const current = useDiscoverySave(request, saved, open);
  useLayoutEffect(() => {
    result = current;
  });
  return null;
}
async function render(key = "first", account = "alice", open = true) {
  root ??= createRoot(document.createElement("div"));
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={account}>
        <View key={key} open={open} />
      </AdminSessionBoundary>
    )
  );
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
});
it("waits for every upload and claims a rapid save only once", async () => {
  const pending = deferred();
  request.mockReturnValue(pending.promise);
  await render();
  await act(async () => {
    result.markUpload("desktop", true);
    result.markUpload("mobile", true);
    void result.save();
    result.markUpload("desktop", false);
    void result.save();
  });
  expect(request).not.toHaveBeenCalled();
  await act(async () => {
    result.markUpload("mobile", false);
    void result.save();
    void result.save();
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(result.saving).toBe(true);
  await act(async () => pending.resolve());
  expect(saved).toHaveBeenCalledTimes(1);
  expect(result.saving).toBe(false);
});
it("retains failed saves for retry without calling successful completion", async () => {
  request.mockRejectedValueOnce(new Error("Version conflict")).mockResolvedValueOnce();
  await render();
  await act(async () => result.save());
  expect(result.saveError).toBe("Version conflict");
  expect(saved).not.toHaveBeenCalled();
  await act(async () => result.save());
  expect(saved).toHaveBeenCalledTimes(1);
  expect(result.saveError).toBeNull();
});
it.each(["drawer", "account", "close"])(
  "suppresses saved callbacks after %s replacement",
  async (change) => {
    const pending = deferred();
    request.mockReturnValue(pending.promise);
    await render();
    const old = result;
    await act(async () => {
      void old.save();
    });
    const signal = request.mock.calls[0][0];
    await render(
      change === "drawer" ? "new" : "first",
      change === "account" ? "bob" : "alice",
      change !== "close"
    );
    expect(signal.aborted).toBe(true);
    await act(async () => {
      void old.save();
      pending.resolve();
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
  }
);
