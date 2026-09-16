// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { IpRevenueSection } from "./ip-revenue-section";
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant,
    size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
function response(owner: string, version = 1) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        code: 200,
        data: {
          ownerUserId: owner,
          version,
          creatorRevenueShareBps: 5000,
          defaultShareBps: 5000,
          effectiveShareBps: 5000,
          contributors: [],
        },
      }),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(ipId = "first", locale = "en-US", session = "alice") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={session}>
        <IpRevenueSection ipId={ipId} locale={locale} />
      </AdminSessionBoundary>
    )
  );
  await act(async () => vi.advanceTimersByTime(1));
}
async function edit(value: string) {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function save() {
  [...container.querySelectorAll("button")]
    .find((button) => button.textContent?.includes("保存"))!
    .click();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("does not hydrate the replacement IP from an abandoned revenue read", async () => {
  vi.useFakeTimers();
  const old = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response("new owner"));
  await render();
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("new");
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(response("old owner")));
  expect(container.textContent).toContain("new owner");
  expect(container.textContent).not.toContain("old owner");
});
it("preserves dirty percentages and original conflict version when locale changes", async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValue(response("owner", 4));
  await render();
  await edit("65");
  await render("first", "zh-CN");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("input")!.value).toBe("65");
  await act(async () => save());
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
    creatorRevenueShareBps: 6500,
    expectedVersion: 4,
  });
});
it("excludes duplicate saves, disables editing and retains a failed draft for retry", async () => {
  vi.useFakeTimers();
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockResolvedValueOnce(response("owner"))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(response("owner", 2));
  await render();
  await edit("60");
  await act(async () => {
    save();
    save();
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.disabled).toBe(true);
  await act(async () => pending.reject(new Error("Version conflict")));
  expect(container.querySelector("input")!.value).toBe("60");
  expect(container.textContent).toContain("Version conflict");
  expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.disabled).toBe(false);
  await act(async () => save());
  expect(container.textContent).toContain("已保存");
});
it("does not display an old save in a replacement administrator session", async () => {
  vi.useFakeTimers();
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockResolvedValueOnce(response("alice owner"))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(response("bob owner"));
  await render();
  await act(async () => save());
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await render("first", "en-US", "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response("alice owner", 2)));
  expect(container.textContent).toContain("bob owner");
  expect(container.textContent).not.toContain("已保存");
});
