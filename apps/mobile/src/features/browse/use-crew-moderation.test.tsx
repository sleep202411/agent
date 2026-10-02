import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCrewModeration } from "./use-crew-moderation";
const h = vi.hoisted(() => ({ generation: 1, active: true, block: vi.fn(), report: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/data/browse-service", () => ({ blockCrew: h.block, reportCrew: h.report }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, state: ReturnType<typeof useCrewModeration>;
function Probe({ id }: { id: string }) {
  const current = useCrewModeration(id, h.generation, h.active);
  useLayoutEffect(() => {
    state = current;
  });
  return <span>{String(current.submitting)}</span>;
}
const render = (id = "crew") => act(async () => root.render(<Probe id={id} />));
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("serializes report/block submissions, including immediate duplicate taps", async () => {
  const pending = deferred(),
    success = vi.fn(),
    failure = vi.fn();
  h.report.mockReturnValueOnce(pending.promise);
  await render();
  let request!: Promise<void>;
  await act(async () => {
    request = state.submit("fraud", success, failure);
    void state.submit("fraud", success, failure);
    void state.submit(undefined, success, failure);
  });
  expect(h.report).toHaveBeenCalledExactlyOnceWith("crew", "fraud");
  expect(h.block).not.toHaveBeenCalled();
  expect(host.textContent).toBe("true");
  await render();
  await act(async () => {
    void state.submit(undefined, success, failure);
  });
  expect(h.block).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve();
    await request;
  });
  expect(success).toHaveBeenCalledTimes(1);
  expect(failure).not.toHaveBeenCalled();
  expect(host.textContent).toBe("false");
});
it.each(["account", "crew", "unmount"])(
  "ignores stale confirmations and responses after %s changes",
  async (change) => {
    const pending = deferred(),
      success = vi.fn(),
      failure = vi.fn();
    h.block.mockReturnValueOnce(pending.promise);
    await render();
    const old = state;
    let request!: Promise<void>;
    await act(async () => {
      request = old.submit(undefined, success, failure);
    });
    if (change === "account") {
      h.generation++;
      await render();
    } else if (change === "crew") await render("other");
    else await act(async () => root.render(null));
    await act(async () => {
      await old.submit(undefined, success, failure);
      pending.resolve();
      await request;
    });
    expect(h.block).toHaveBeenCalledTimes(1);
    expect(old.isCurrent()).toBe(false);
    expect(success).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  }
);
it("checks the current auth generation even before React rerenders", async () => {
  await render();
  h.generation++;
  await act(async () => {
    await state.submit(undefined, vi.fn(), vi.fn());
  });
  expect(h.block).not.toHaveBeenCalled();
});
it("forwards the exact failure and permits an explicit retry", async () => {
  const error = new Error("Reporting temporarily unavailable"),
    success = vi.fn(),
    failure = vi.fn();
  h.report.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
  await render();
  await act(async () => {
    await state.submit("privacy", success, failure);
  });
  expect(failure).toHaveBeenCalledExactlyOnceWith(error);
  expect(host.textContent).toBe("false");
  await act(async () => {
    await state.submit("privacy", success, failure);
  });
  expect(success).toHaveBeenCalledTimes(1);
});
it("ignores a late failure without unlocking a newer account's pending operation", async () => {
  const old = deferred(),
    next = deferred(),
    failure = vi.fn();
  h.block.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await render();
  let first!: Promise<void>, second!: Promise<void>;
  await act(async () => {
    first = state.submit(undefined, vi.fn(), failure);
  });
  h.generation++;
  await render();
  await act(async () => {
    second = state.submit(undefined, vi.fn(), failure);
  });
  await act(async () => {
    old.reject(new Error("Old session"));
    await first;
  });
  expect(failure).not.toHaveBeenCalled();
  expect(host.textContent).toBe("true");
  await act(async () => {
    next.resolve();
    await second;
  });
  expect(host.textContent).toBe("false");
});

it("keeps pending work serialized on return but ignores hidden-screen callbacks", async () => {
  const pending = deferred(),
    success = vi.fn(),
    failure = vi.fn();
  h.block.mockReturnValueOnce(pending.promise);
  await render();
  let request!: Promise<void>;
  await act(async () => {
    request = state.submit(undefined, success, failure);
  });
  h.active = false;
  await render();
  expect(state.isCurrent()).toBe(false);
  await act(async () => {
    await state.submit(undefined, success, failure);
  });
  h.active = true;
  await render();
  await act(async () => {
    await state.submit(undefined, success, failure);
  });
  expect(h.block).toHaveBeenCalledTimes(1);
  h.active = false;
  await render();
  await act(async () => {
    pending.resolve();
    await request;
  });
  expect(success).not.toHaveBeenCalled();
  h.active = true;
  await render();
  expect(host.textContent).toBe("false");
});
