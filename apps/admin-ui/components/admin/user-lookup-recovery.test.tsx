// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "./admin-session-boundary";
import { InstructorPicker } from "./courses/instructor-picker";
import { CommissionRateForm } from "./growth/commission-rates";

vi.mock("./billing/shared", async (original) => ({
  ...(await original<object>()),
  AdminDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <section>{children}</section> : null,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const onChange = vi.fn();
const user = (id: string) => ({ userId: id, nickName: id, email: null, phone: null });
const response = (id: string) => ({
  ok: true,
  json: () => Promise.resolve({ code: 200, data: [user(id)] }),
});
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function render(view: ReactNode, session = "alice") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(<AdminSessionBoundary scopeKey={session}>{view}</AdminSessionBoundary>)
  );
}
const picker = () => <InstructorPicker instructors={[]} onChange={onChange} />;
const commission = (id?: string) => (
  <CommissionRateForm
    loading={false}
    onSubmit={vi.fn()}
    rate={
      id
        ? {
            id,
            userId: id,
            nickName: id,
            email: null,
            commissionBps: 1200,
            note: null,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }
        : undefined
    }
  />
);
function click(text: string) {
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!.click();
}
async function query(value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="邮箱 / 手机 / 昵称 / ID"]'
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("cancels closed instructor searches and preserves replacement results", async () => {
  const old = deferred();
  fetchMock.mockReturnValueOnce(old.promise).mockResolvedValue(response("new-user"));
  await render(picker());
  await act(async () => click("添加讲师"));
  await query("old");
  await act(async () => {
    click("查找");
    click("查找");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => click("关闭"));
  expect(signal.aborted).toBe(true);
  await act(async () => click("添加讲师"));
  await query("new");
  await act(async () => click("查找"));
  await act(async () => old.resolve(response("stale-user")));
  expect(container.textContent).toContain("new-user");
  expect(container.textContent).not.toContain("stale-user");
});
it("cancels a changed query without waiting for its response", async () => {
  const old = deferred();
  fetchMock.mockReturnValueOnce(old.promise).mockResolvedValue(response("replacement"));
  await render(commission());
  await query("old");
  await act(async () => click("查找"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await query("new");
  expect(signal.aborted).toBe(true);
  await act(async () => click("查找"));
  await act(async () => old.resolve(response("obsolete")));
  expect(container.textContent).toContain("replacement");
  expect(container.textContent).not.toContain("obsolete");
});
it("retains loaded matches on failed refresh and retries", async () => {
  fetchMock
    .mockResolvedValueOnce(response("known-user"))
    .mockRejectedValueOnce(new Error("Lookup unavailable"))
    .mockResolvedValue(response("recovered-user"));
  await render(commission());
  await query("same");
  await act(async () => click("查找"));
  await act(async () => click("查找"));
  expect(container.textContent).toContain("known-user");
  expect(container.textContent).toContain("Lookup unavailable");
  await act(async () => click("查找"));
  expect(container.textContent).toContain("recovered-user");
});
it("cancels lookups on account replacement and clears private matches", async () => {
  const old = deferred();
  fetchMock.mockReturnValue(old.promise);
  await render(commission());
  await query("old");
  await act(async () => click("查找"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(commission(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(response("private-user")));
  expect(container.textContent).not.toContain("private-user");
});
it("replaces commission draft identity and cancels its old lookup", async () => {
  const old = deferred();
  fetchMock.mockReturnValue(old.promise);
  await render(commission());
  await query("old");
  await act(async () => click("查找"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(commission("fixed-user"));
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(response("old-user")));
  expect(container.querySelector<HTMLInputElement>('input[name="userId"]')!.value).toBe(
    "fixed-user"
  );
  expect(container.querySelector<HTMLInputElement>('input[name="ratePercent"]')!.value).toBe("12");
});
