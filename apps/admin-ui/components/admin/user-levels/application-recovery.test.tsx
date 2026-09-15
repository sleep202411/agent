// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { UserLevelApplicationsPanel } from "./user-level-applications-panel";
import type { AdminUserLevelApplication } from "@/lib/admin-user-level-applications";
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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const row: AdminUserLevelApplication = {
  id: 1,
  userId: 123,
  userName: "Applicant",
  levelId: 1,
  levelName: "FD",
  crewName: "Crew",
  crewLink: "https://fixture.invalid/crew",
  ipName: "IP",
  ipLink: "https://fixture.invalid/ip",
  attachmentUrl: null,
  extraInfo: null,
  status: 0,
  adminRemark: "Captured reason",
  createTime: null,
  updateTime: null,
};
const list = (name = "Applicant") => ({
  items: [{ ...row, userName: name }],
  total: 1,
  page: 1,
  pageSize: 20,
});
const response = (data: unknown = list()) => ({
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
        <UserLevelApplicationsPanel
          siteLabel="Global"
          databaseLabel="Fixture"
          initialList={list()}
          initialLevels={[]}
          initialError={null}
        />
      </AdminSessionBoundary>
    )
  );
}
function click(text: string) {
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!.click();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("excludes rapid competing decisions and preserves failed remarks for retry", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render();
  await act(async () => click("审批"));
  await act(async () => {
    click("通过");
    click("驳回");
    click("Close fixture");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => pending.reject(new Error("Review unavailable")));
  expect(container.querySelector("textarea")!.value).toBe("Captured reason");
  expect(container.textContent).toContain("Review unavailable");
  await act(async () => click("通过"));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it("retains loaded applications and exposes follow-up failures outside the closed dialog", async () => {
  fetchMock
    .mockResolvedValueOnce(response(null))
    .mockRejectedValueOnce(new Error("List unavailable"))
    .mockResolvedValue(response(list("Recovered")));
  await render();
  await act(async () => click("审批"));
  await act(async () => click("通过"));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain("Applicant");
  expect(container.textContent).toContain("List unavailable");
  expect(fetchMock.mock.calls[0][1].signal).toBe(fetchMock.mock.calls[1][1].signal);
  await act(async () => click("刷新"));
  expect(container.textContent).toContain("Recovered");
});
it("replaces delayed filter reads without stale list changes", async () => {
  const old = deferred();
  fetchMock.mockReturnValueOnce(old.promise).mockResolvedValue(response(list("Current")));
  await render();
  await act(async () => click("刷新"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="状态"]')!;
    select.value = "1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(response(list("Stale"))));
  expect(container.textContent).toContain("Current");
  expect(container.textContent).not.toContain("Stale");
});
it("cancels an old account decision before its queued list refresh", async () => {
  const old = deferred();
  fetchMock.mockReturnValue(old.promise);
  await render();
  await act(async () => click("审批"));
  await act(async () => click("通过"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("bob");
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(response()));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it("rejects unsafe user identifiers without discarding the loaded list", async () => {
  await render();
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="用户 ID（可选）"]'
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "9007199254740993"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => click("搜索"));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Applicant");
  expect(container.textContent).toContain("positive safe integer");
});
