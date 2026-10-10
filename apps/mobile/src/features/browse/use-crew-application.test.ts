import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCrewApplication } from "./use-crew-application";

const h = vi.hoisted(() => ({ request: vi.fn(), generation: 1 }));
vi.mock("@/data/browse-service", () => ({ applyToCrewPosition: h.request }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let state: ReturnType<typeof useCrewApplication>;
const success = vi.fn();
const failure = vi.fn();
function Probe({ crewId }: { crewId: string }) {
  const observed = useCrewApplication(crewId);
  useLayoutEffect(() => {
    state = observed;
  }, [observed]);
  return null;
}
async function render(crewId = "crew-a") {
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe, { crewId })));
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

it("admits only one request from repeated confirmations before a render", async () => {
  const request = deferred();
  h.request.mockReturnValue(request.promise);
  await render();
  let first!: Promise<void>;
  await act(async () => {
    first = state.submit("position", success, failure);
    void state.submit("position", success, failure);
  });
  expect(h.request).toHaveBeenCalledExactlyOnceWith("crew-a", "position", expect.any(AbortSignal));
  expect(state.applying).toBe(true);
  await act(async () => {
    request.resolve();
    await first;
  });
  expect(success).toHaveBeenCalledTimes(1);
  expect(state.applying).toBe(false);
});
it("allows an explicit retry after failure and passes through the original error", async () => {
  const error = new Error("Position is full");
  h.request.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
  await render();
  await act(async () => state.submit("position", success, failure));
  expect(failure).toHaveBeenCalledWith(error);
  expect(state.applying).toBe(false);
  await act(async () => state.submit("position", success, failure));
  expect(h.request).toHaveBeenCalledTimes(2);
  expect(success).toHaveBeenCalledTimes(1);
});
it("ignores retained confirmations and completions after switching Crew pages", async () => {
  const old = deferred();
  const next = deferred();
  h.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await render();
  const oldSubmit = state.submit;
  let first!: Promise<void>;
  await act(async () => {
    first = oldSubmit("old-role", success, failure);
  });
  await render("crew-b");
  expect(state.applying).toBe(false);
  let second!: Promise<void>;
  await act(async () => {
    await oldSubmit("old-role", success, failure);
    second = state.submit("new-role", success, failure);
  });
  await act(async () => {
    old.reject(new Error("old failure"));
    await first;
  });
  expect(failure).not.toHaveBeenCalled();
  expect(state.applying).toBe(true);
  expect(h.request).toHaveBeenCalledTimes(2);
  await act(async () => {
    next.resolve();
    await second;
  });
  expect(success).toHaveBeenCalledTimes(1);
  expect(state.applying).toBe(false);
});
it.each(["success", "failure"])("suppresses a late %s after unmount", async (outcome) => {
  const request = deferred();
  h.request.mockReturnValueOnce(request.promise);
  await render();
  const submit = state.submit;
  let pending!: Promise<void>;
  await act(async () => {
    pending = submit("position", success, failure);
  });
  await act(async () => root!.unmount());
  root = undefined;
  await act(async () => {
    if (outcome === "success") request.resolve();
    else request.reject(new Error("Unauthorized"));
    await pending;
    await submit("position", success, failure);
  });
  expect(success).not.toHaveBeenCalled();
  expect(failure).not.toHaveBeenCalled();
  expect(h.request).toHaveBeenCalledTimes(1);
});
it("does not show another account's result after the session changes", async () => {
  const request = deferred();
  h.request.mockReturnValueOnce(request.promise);
  await render();
  let pending!: Promise<void>;
  await act(async () => {
    pending = state.submit("position", success, failure);
  });
  h.generation++;
  await act(async () => {
    request.resolve();
    await pending;
  });
  expect(success).not.toHaveBeenCalled();
  expect(failure).not.toHaveBeenCalled();
  expect(state.applying).toBe(false);
});
