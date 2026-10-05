// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { BillingComputeMemberUsagePanel } from "./compute-member-usage-panel";
import type { AdminComputeMemberUsageData } from "./types";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const data = (name: string): AdminComputeMemberUsageData => ({
  rangeDays: 30,
  workspaceKind: "all",
  workspaceId: null,
  totalCredits: "9007199254740993",
  memberCount: 1,
  workspaceCount: 1,
  members: [
    {
      userId: name,
      nickName: name,
      email: null,
      phone: null,
      totalCredits: "9007199254740993",
      totalJobs: 1,
      totalImageJobs: 1,
      totalVideoJobs: 0,
      workspaces: [],
    },
  ],
});
const response = (name: string) => ({
  ok: true,
  json: async () => ({ code: 200, data: data(name) }),
});
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(scope = "alice", name = "Initial", initialData = data(name)) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  vi.stubGlobal("fetch", fetchMock);
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={scope}>
        <BillingComputeMemberUsagePanel
          siteLabel="Fixture"
          databaseLabel="Fixture"
          initialData={initialData}
        />
      </AdminSessionBoundary>
    )
  );
}
function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === text || node.getAttribute("aria-label") === text
  );
  expect(button).toBeTruthy();
  button!.click();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

it("combines rapid filter changes and ignores the displaced result", async () => {
  const first = deferred();
  const second = deferred();
  fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await render();
  await act(async () => {
    click("7 天");
    click("共享工作区");
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toContain("days=7&workspaceKind=shared");
  expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
  await act(async () => first.resolve(response("Old")));
  expect(container.querySelector<HTMLButtonElement>('[aria-label="刷新"]')!.disabled).toBe(true);
  expect(container.textContent).not.toContain("Old");
  await act(async () => second.resolve(response("Current")));
  expect(container.textContent).toContain("Current");
  expect(container.querySelector<HTMLButtonElement>('[aria-label="刷新"]')!.disabled).toBe(false);
});

it("retains loaded records on failure and allows explicit retry", async () => {
  fetchMock
    .mockRejectedValueOnce(new Error("Usage unavailable"))
    .mockResolvedValueOnce(response("Recovered"));
  await render();
  await act(async () => click("刷新"));
  expect(container.textContent).toContain("Initial");
  expect(container.textContent).toContain("Usage unavailable");
  await act(async () => click("刷新"));
  expect(container.textContent).toContain("Recovered");
});

it("cancels session-abandoned reads and suppresses their errors", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => click("刷新"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("bob", "Bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.reject(new Error("Old error")));
  expect(container.textContent).toContain("Bob");
  expect(container.textContent).not.toContain("Old error");
});

it("preserves filtered data across same-session server refresh and cancels on unmount", async () => {
  const pending = deferred();
  fetchMock.mockResolvedValueOnce(response("Filtered")).mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => click("7 天"));
  await render("alice", "Server refresh");
  expect(container.textContent).toContain("Filtered");
  expect(container.textContent).not.toContain("Server refresh");
  await act(async () => click("刷新"));
  expect(fetchMock.mock.calls[1][0]).toContain("days=7");
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await act(async () => root?.unmount());
  root = undefined;
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response("Abandoned")));
});

it("accepts matching new server snapshots without replacing client results on unchanged props", async () => {
  const initial = data("Initial snapshot");
  await render("alice", "Initial snapshot", initial);
  fetchMock.mockResolvedValueOnce(response("Client refresh"));
  await act(async () => click("刷新"));
  await render("alice", "Initial snapshot", initial);
  expect(container.textContent).toContain("Client refresh");
  await render("alice", "New snapshot", data("New snapshot"));
  expect(container.textContent).toContain("New snapshot");
  expect(container.textContent).not.toContain("Client refresh");
});

async function typeUser(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    'input[placeholder="用户 ID"], input[placeholder="手机 / 邮箱"]'
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each(["18424", "273848", "u_abcd"])(
  "routes explicit ID %s through the ID filter",
  async (id) => {
    fetchMock.mockResolvedValue(response("Matched"));
    await render();
    await typeUser(id);
    await act(async () => click("查询"));
    const url = new URL(fetchMock.mock.calls[0][0], "https://fixture.test");
    expect(url.searchParams.get("userId")).toBe(id);
    expect(url.searchParams.has("userQuery")).toBe(false);
  }
);
it("routes a numeric phone through contact lookup when selected", async () => {
  fetchMock.mockResolvedValue(response("Matched"));
  await render();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  await act(async () =>
    container
      .querySelector('[role="combobox"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
  );
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (el) => el.textContent === "手机 / 邮箱"
  )!;
  await act(async () => {
    (option as HTMLElement).focus();
    option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await typeUser("13800138000");
  await act(async () => click("查询"));
  const url = new URL(fetchMock.mock.calls[0][0], "https://fixture.test");
  expect(url.searchParams.get("userQuery")).toBe("13800138000");
  expect(url.searchParams.has("userId")).toBe(false);
});
