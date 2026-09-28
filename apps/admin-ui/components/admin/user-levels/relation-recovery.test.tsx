// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { UserLevelsPanel } from "./user-levels-panel";
const confirmError = vi.hoisted(() => vi.fn());
vi.mock("../billing/shared", async (original) => ({
  ...(await original<object>()),
  AdminDialog: ({
    open,
    children,
    footer,
    onClose,
  }: {
    open: boolean;
    children: ReactNode;
    footer: ReactNode;
    onClose: () => void;
  }) =>
    open ? (
      <section role="dialog">
        <button onClick={onClose}>Close fixture</button>
        {children}
        {footer}
      </section>
    ) : null,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => Promise<void> }) =>
    open ? (
      <button onClick={() => void onConfirm().catch(confirmError)}>Confirm fixture</button>
    ) : null,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const row = {
  id: 1,
  userId: 123,
  userName: "Member",
  levelId: 1,
  levelName: "FD",
  remark: "Saved remark",
  createTime: null,
  updateTime: null,
};
const level = {
  id: 1,
  name: "FD",
  description: "Level",
  imagePath: null,
  type: null,
  remark: null,
  createTime: null,
  updateTime: null,
};
const list = { items: [row], total: 1, page: 1, pageSize: 20 };
const response = (data: unknown = list) => ({
  ok: true,
  json: () => Promise.resolve({ code: 200, data }),
});
function deferred() {
  let resolve!: (r: ReturnType<typeof response>) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(session = "alice") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={session}>
        <UserLevelsPanel
          siteLabel="Global"
          databaseLabel="Fixture"
          initialList={list}
          initialLevels={[level]}
          initialError={null}
        />
      </AdminSessionBoundary>
    )
  );
}
function click(text: string) {
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!.click();
}
async function lookup(value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => click("查找"));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("guards duplicate saves and keeps failed remarks", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render();
  await act(async () => click("编辑"));
  await act(async () => {
    click("保存");
    click("保存");
    click("删除");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    [...container.querySelectorAll("button")].find((button) => button.textContent === "保存中…")
      ?.disabled
  ).toBe(true);
  await act(async () => pending.reject(new Error("Save unavailable")));
  expect(container.querySelector("textarea")!.value).toBe("Saved remark");
  expect(container.textContent).toContain("Save unavailable");
  await act(async () => click("保存"));
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
it("cancels closed lookup and permits a replacement before the old response settles", async () => {
  const old = deferred();
  fetchMock.mockReturnValueOnce(old.promise).mockResolvedValue(
    response({
      items: [{ userId: "456", nickName: "Replacement", email: null, phone: null }],
      total: 1,
      page: 1,
      pageSize: 100,
    })
  );
  await render();
  await act(async () => click("授予等级"));
  await lookup("old");
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => click("Close fixture"));
  expect(signal.aborted).toBe(true);
  await act(async () => click("授予等级"));
  await lookup("new");
  await act(async () =>
    old.resolve(
      response({
        items: [{ userId: "123", nickName: "Stale", email: null, phone: null }],
        total: 1,
        page: 1,
        pageSize: 100,
      })
    )
  );
  expect(container.textContent).toContain("Replacement");
  expect(container.textContent).not.toContain("Stale");
});
it("preserves the new lookup after changing its query", async () => {
  const old = deferred();
  fetchMock
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(response({ items: [], total: 0, page: 1, pageSize: 100 }));
  await render();
  await act(async () => click("授予等级"));
  await lookup("old");
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await lookup("new");
  expect(signal.aborted).toBe(true);
  await act(async () =>
    old.resolve(
      response({
        items: [{ userId: "123", nickName: "Stale", email: null, phone: null }],
        total: 1,
        page: 1,
        pageSize: 100,
      })
    )
  );
  expect(container.textContent).not.toContain("Stale");
  expect(container.textContent).toContain("No matching users");
});
it("propagates deletion failures for confirmation retry and retains rows", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Delete unavailable")).mockResolvedValue(response());
  await render();
  await act(async () => click("删除"));
  await act(async () => click("Confirm fixture"));
  expect(confirmError).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Delete unavailable" })
  );
  expect(container.textContent).toContain("Member");
  await act(async () => click("Confirm fixture"));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls[1][1].signal).toBe(fetchMock.mock.calls[2][1].signal);
});
it("cancels saved-account results and skips their follow-up reads", async () => {
  const old = deferred();
  fetchMock.mockReturnValue(old.promise);
  await render();
  await act(async () => click("编辑"));
  await act(async () => click("保存"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("bob");
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(response()));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
