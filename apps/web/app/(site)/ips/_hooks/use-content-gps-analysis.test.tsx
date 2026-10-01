// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useContentGpsAnalysis } from "./use-content-gps-analysis";
import { api, ApiRequestError } from "@/src/lib/api";
vi.mock("@/src/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
let hook: ReturnType<typeof useContentGpsAnalysis>;
let root: Root;
let host: HTMLDivElement;
const ready = vi.fn();
const denied = vi.fn();
const ip = "01900000-0000-7000-8000-000000000001";
const id = "01900000-0000-7000-8000-000000000002";
const key = `content-gps-analysis:owner:${ip}:en-US`;
function receipt(requestId = id, status = "succeeded") {
  return {
    id: requestId,
    status,
    sourceFingerprint: "a".repeat(64),
    analysisVersion: "v1",
    createdAt: "2026-10-01T00:00:00.000Z",
    finishedAt: null,
  };
}
function Harness({ user = "owner" }: { user?: string }) {
  const value = useContentGpsAnalysis(ip, user, "en-US", denied, ready);
  useLayoutEffect(() => {
    hook = value;
  });
  return null;
}
async function render(user = "owner") {
  await act(async () => root.render(<Harness key={user} user={user} />));
}
function persist() {
  sessionStorage.setItem(key, JSON.stringify({ requestId: id, locale: "en-US" }));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("persists before dispatch, prevents double dispatch, and reads receipt before suggestions", async () => {
  await render();
  expect(api.post).not.toHaveBeenCalled();
  vi.mocked(api.post).mockImplementation(async (_url, options) => {
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(options!.data);
    return {};
  });
  vi.mocked(api.get).mockImplementation(async (url) => receipt(String(url).split("/").at(-1)));
  await act(async () => {
    const first = hook.analyze();
    await hook.analyze();
    await first;
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(ready).toHaveBeenCalledTimes(1);
  expect(hook.receipt?.status).toBe("succeeded");
});
it("recovers lost reply by GET after remount without resending analysis", async () => {
  await render();
  vi.mocked(api.post).mockRejectedValue(new Error("Connection lost"));
  await act(async () => hook.analyze());
  const saved = JSON.parse(sessionStorage.getItem(key)!);
  expect(hook.canAnalyze).toBe(false);
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  expect(hook.request).toEqual(saved);
  expect(api.get).not.toHaveBeenCalled();
  vi.mocked(api.get).mockResolvedValue(receipt(saved.requestId));
  await act(async () => hook.check());
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(ready).toHaveBeenCalledTimes(1);
});
it("permits only explicit identical retry after missing receipt and preserves owner access", async () => {
  persist();
  await render();
  vi.mocked(api.get).mockRejectedValue(
    new ApiRequestError("404", "Analysis request not found.", 404)
  );
  await act(async () => hook.check());
  expect(denied).not.toHaveBeenCalled();
  expect(hook.canAnalyze).toBe(true);
  expect(api.post).not.toHaveBeenCalled();
  vi.mocked(api.post).mockResolvedValue({});
  vi.mocked(api.get).mockResolvedValue(receipt());
  await act(async () => hook.analyze());
  expect(vi.mocked(api.post).mock.calls[0]![1]!.data).toEqual({ requestId: id, locale: "en-US" });
});
it("keeps uncertain and dispatched requests locked without polling", async () => {
  persist();
  await render();
  for (const status of ["uncertain", "dispatched"]) {
    vi.mocked(api.get).mockResolvedValue(receipt(id, status));
    await act(async () => hook.check());
    await act(async () => hook.analyze());
    expect(hook.canAnalyze).toBe(false);
  }
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(api.post).not.toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled();
});
it("rejects mismatched receipt without displaying success", async () => {
  persist();
  await render();
  vi.mocked(api.get).mockResolvedValue(receipt(ip));
  await act(async () => hook.check());
  expect(hook.error).toContain("does not match");
  expect(hook.receipt).toBeNull();
  expect(ready).not.toHaveBeenCalled();
});
it("aborts old-account request and cannot restore its receipt", async () => {
  persist();
  await render();
  let resolve!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = hook.check();
  });
  const signal = vi.mocked(api.get).mock.calls[0]![1]!.signal;
  await render("other");
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    resolve(receipt());
    await pending;
  });
  expect(hook.request).toBeNull();
  expect(hook.receipt).toBeNull();
  expect(ready).not.toHaveBeenCalled();
});
it("does not dispatch when browser storage fails", async () => {
  await render();
  vi.stubGlobal("sessionStorage", {
    setItem: () => {
      throw new Error("Storage unavailable");
    },
  });
  await act(async () => hook.analyze());
  expect(api.post).not.toHaveBeenCalled();
  expect(hook.error).toBe("Storage unavailable");
});

it("clears a successful receipt when a subsequent check fails", async () => {
  persist();
  await render();
  vi.mocked(api.get).mockResolvedValue(receipt());
  await act(async () => hook.check());
  expect(hook.canAnalyze).toBe(true);
  vi.mocked(api.get).mockRejectedValue(new Error("Service unavailable"));
  await act(async () => hook.check());
  expect(hook.receipt).toBeNull();
  expect(hook.canAnalyze).toBe(false);
});
it("propagates authentication denial to the owner editor", async () => {
  persist();
  await render();
  const error = new ApiRequestError("401", "Login required", 401);
  vi.mocked(api.get).mockRejectedValue(error);
  await act(async () => hook.check());
  expect(denied).toHaveBeenCalledWith(error);
  expect(api.post).not.toHaveBeenCalled();
});
