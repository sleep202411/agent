// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { useDiscoveryUpload } from "./use-discovery-upload";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let result: ReturnType<typeof useDiscoveryUpload>;
const fetchMock = vi.fn();
const changed = vi.fn();
const revoke = vi.fn();
const pendingChanged = vi.fn();
let disabled = false;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function response(id: string) {
  return {
    ok: true,
    json: () => Promise.resolve({ code: 200, data: { asset: { id, url: null } } }),
  };
}
function View({ open }: { open: boolean }) {
  const current = useDiscoveryUpload("image", changed, pendingChanged, disabled, open);
  useLayoutEffect(() => {
    result = current;
  });
  return null;
}
async function render(key = "first", account = "alice", open = true) {
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = revoke;
  root ??= createRoot(document.createElement("div"));
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={account}>
        <View key={key} open={open} />
      </AdminSessionBoundary>
    )
  );
}
const file = () => new File(["image"], "image.png", { type: "image/png" });
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  disabled = false;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("claims rapid upload/clear events once and releases successful preview URLs", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render();
  await act(async () => {
    void result.upload(file());
    void result.upload(file());
    result.clear();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(pendingChanged.mock.calls).toEqual([[true]]);
  expect(changed).not.toHaveBeenCalled();
  expect(result.uploading).toBe(true);
  await act(async () => pending.resolve(response("asset")));
  expect(changed).toHaveBeenCalledWith({
    assetId: "asset",
    url: "/api/admin/media/assets/asset/content?variantKey=original",
  });
  expect(revoke).toHaveBeenCalledTimes(1);
  expect(pendingChanged.mock.calls).toEqual([[true], [false]]);
  expect(result.preview).toBeNull();
  expect(result.uploading).toBe(false);
});
it.each(["field", "account", "close"])(
  "abandons uploads on %s changes and rejects retained callbacks",
  async (change) => {
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValue(pending.promise);
    await render();
    const old = result;
    await act(async () => {
      void old.upload(file());
    });
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await render(
      change === "field" ? "new" : "first",
      change === "account" ? "bob" : "alice",
      change !== "close"
    );
    expect(signal.aborted).toBe(true);
    expect(revoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      void old.upload(file());
      pending.resolve(response("old"));
    });
    expect(changed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }
);
it("retains retryable errors and does not let an old upload finish a replacement", async () => {
  const old = deferred<ReturnType<typeof response>>();
  const replacement = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(replacement.promise)
    .mockResolvedValue(response("retry"));
  await render();
  await act(async () => {
    void result.upload(file());
  });
  await render("replacement");
  await act(async () => {
    void result.upload(file());
    old.reject(new Error("old failure"));
  });
  expect(result.uploading).toBe(true);
  expect(result.error).toBeNull();
  await act(async () => replacement.reject(new Error("Storage unavailable")));
  expect(result.error).toBe("Storage unavailable");
  expect(result.uploading).toBe(false);
  await act(async () => result.upload(file()));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(result.error).toBeNull();
});
it("releases admission when preview creation throws", async () => {
  await render();
  vi.mocked(URL.createObjectURL).mockImplementationOnce(() => {
    throw new Error("Preview failed");
  });
  await act(async () => result.upload(file()));
  expect(result.error).toBe("Preview failed");
  expect(result.uploading).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(response("retry"));
  await act(async () => result.upload(file()));
  expect(changed).toHaveBeenCalledTimes(1);
});

it("rejects retained upload/clear callbacks while the editor is saving", async () => {
  await render();
  const old = result;
  disabled = true;
  await render();
  await act(async () => {
    void old.upload(file());
    old.clear();
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(pendingChanged).not.toHaveBeenCalled();
});
