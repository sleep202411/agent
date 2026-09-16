// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { AgentUsersPanel } from "./agent-users-panel";
import type { AdminAgentUser } from "@/lib/admin-agent-users";
vi.mock("@/components/ui/sheet", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Sheet: ({
      open,
      children,
      onOpenChange,
    }: {
      open: boolean;
      children: ReactNode;
      onOpenChange: (open: boolean) => void;
    }) =>
      open ? (
        <section role="dialog">
          <button onClick={() => onOpenChange(false)}>Close fixture</button>
          {children}
        </section>
      ) : null,
    SheetContent: Part,
    SheetHeader: Part,
    SheetFooter: Part,
    SheetTitle: Part,
    SheetDescription: Part,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const agent = (id: string): AdminAgentUser => ({
  id,
  handle: id,
  displayName: id,
  avatarUrl: null,
  status: "active",
  identityStatus: "shadow",
  platformUserId: null,
  simulatedEmail: null,
  locale: "en-US",
  region: "SG",
  timezone: "Asia/Singapore",
  persona: {},
  schedule: {},
  policy: {},
  notes: null,
  createdByAdminId: null,
  updatedByAdminId: null,
  lastRunAt: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  disabledAt: null,
  runCount: 0,
  actionCount: 0,
  memoryCount: 0,
  latestRun: null,
});
const list = (page = 1) => ({
  items: [agent("one"), agent("two")],
  total: 100,
  page,
  pageSize: 50,
  stats: { activeCount: 2, pausedCount: 0, disabledCount: 0, shadowCount: 2, boundCount: 0 },
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
        <AgentUsersPanel
          siteLabel="Global"
          databaseLabel="Fixture"
          initialData={{ list: list(), error: null }}
        />
      </AdminSessionBoundary>
    )
  );
}
function click(text: string, index = 0) {
  [...container.querySelectorAll("button")]
    .filter((b) => b.textContent?.trim() === text)
    [index]!.click();
}
function submit() {
  container
    .querySelector('[role="dialog"] form')!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("waits for complete detail before saving and permits reopening after failure", async () => {
  const detail = deferred();
  fetchMock
    .mockReturnValueOnce(detail.promise)
    .mockResolvedValue(response({ ...agent("one"), displayName: "Full detail" }));
  await render();
  await act(async () => click("编辑"));
  await act(async () => submit());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[inert]")).not.toBeNull();
  await act(async () => detail.reject(new Error("Detail unavailable")));
  expect(container.textContent).toContain("Detail unavailable");
  await act(async () => click("Close fixture"));
  await act(async () => click("编辑"));
  expect(container.querySelector<HTMLInputElement>('[name="displayName"]')!.value).toBe(
    "Full detail"
  );
});
it("guards duplicate saves, retains failed drafts and retries", async () => {
  const write = deferred();
  fetchMock
    .mockResolvedValueOnce(response(agent("one")))
    .mockReturnValueOnce(write.promise)
    .mockResolvedValue(response());
  await render();
  await act(async () => click("编辑"));
  await act(async () => {
    submit();
    submit();
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(container.querySelector("[inert]")).not.toBeNull();
  await act(async () => write.reject(new Error("Save unavailable")));
  expect(container.querySelector<HTMLInputElement>('[name="displayName"]')!.value).toBe("one");
  expect(container.textContent).toContain("Save unavailable");
  await act(async () => submit());
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
it("cancels closed details and preserves a replacement creator form", async () => {
  const old = deferred();
  fetchMock.mockReturnValue(old.promise);
  await render();
  await act(async () => click("编辑"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => click("Close fixture"));
  expect(signal.aborted).toBe(true);
  await act(async () => click("新建Agent"));
  await act(async () => old.resolve(response({ ...agent("one"), displayName: "Stale" })));
  expect(container.querySelector<HTMLInputElement>('[name="displayName"]')!.value).toBe("");
});
it("skips a departed account's post-write refresh", async () => {
  const old = deferred();
  fetchMock.mockResolvedValueOnce(response(agent("one"))).mockReturnValueOnce(old.promise);
  await render();
  await act(async () => click("编辑"));
  await act(async () => submit());
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await render("bob");
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(response()));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
