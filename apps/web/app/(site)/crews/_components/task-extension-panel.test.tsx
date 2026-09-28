import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskExtensionPanel } from "./task-extension-panel";
import { CrewApiError } from "../_hooks/api";
const h = vi.hoisted(() => ({
  user: "applicant",
  get: vi.fn(),
  post: vi.fn(),
  ready: vi.fn(),
  updated: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: h.user } }) }));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<typeof import("../_hooks/api")>()),
  crewApi: {
    get: (...args: unknown[]) => h.get(...args),
    post: (...args: unknown[]) => h.post(...args),
  },
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
const task = {
  id: "task",
  crewId: "crew",
  version: 3,
  dueAt: "2099-09-25T10:00:00Z",
  startAt: null,
  status: "in_progress",
  assignees: [{ userId: "applicant" }],
} as unknown as import("../_hooks/types").CrewTaskDTO;
let currentTask = task;
const row = {
  id: "request",
  requesterUserId: "applicant",
  taskVersion: 3,
  previousDueAt: task.dueAt,
  requestedDueAt: "2099-09-27T10:00:00Z",
  reason: "More rendering time",
  status: "pending",
  decisionReason: null,
  decidedByUserId: null,
  decidedAt: null,
};
const page = { items: [] as (typeof row)[], nextBeforeId: null };
let root: Root, host: HTMLDivElement, qc: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "applicant";
  currentTask = { ...task };
  vi.clearAllMocks();
  h.get.mockReset().mockResolvedValue(page);
  h.post.mockReset().mockResolvedValue({});
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  host.remove();
});
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
async function render(canManage = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <TaskExtensionPanel task={currentTask} canManage={canManage} />
      </QueryClientProvider>
    )
  );
  await flush();
}
function button(key: string) {
  return Array.from(host.querySelectorAll("button")).find((b) => b.textContent === key);
}
async function click(key: string) {
  expect(button(key)).toBeDefined();
  await act(async () => button(key)!.click());
  await flush();
}
async function field(selector: string, value: string) {
  await act(async () => {
    const node = host.querySelector(selector)!;
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("requests against the reviewed task version with a timezone-explicit deadline", async () => {
  await render();
  await field("textarea", "Need more time");
  await field("input", "2099-09-28T18:00");
  await click("request");
  const body = h.post.mock.calls[0][1].body;
  expect(body).toMatchObject({
    expectedVersion: 3,
    reason: "Need more time",
    requestedDueAt: new Date("2099-09-28T18:00").toISOString(),
  });
  expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
});
it("does not silently rebase a draft after a task edit", async () => {
  await render();
  await field("textarea", "Old version");
  await field("input", "2099-09-28T18:00");
  currentTask = { ...task, version: 4 };
  await render();
  expect(button("request")?.disabled).toBe(true);
  await click("request");
  expect(h.post).not.toHaveBeenCalled();
  await click("discard");
  await field("textarea", "Reviewed version four");
  await field("input", "2099-09-29T18:00");
  await click("request");
  expect(h.post.mock.calls[0][1].body.expectedVersion).toBe(4);
});
it("withdraws one's own pending request and never offers self approval", async () => {
  h.get.mockResolvedValue({ ...page, items: [row] });
  await render(true);
  expect(button("approve")).toBeUndefined();
  expect(button("reject")).toBeUndefined();
  expect(button("request")).toBeUndefined();
  await field("textarea", "No longer needed");
  await click("withdraw");
  expect(h.post).toHaveBeenCalledWith("/crew-tasks/task/extensions/request/decision", {
    body: { action: "withdraw", reason: "No longer needed" },
  });
});
it.each(["approve", "reject"])("allows a manager to %s with a reason", async (action) => {
  h.user = "manager";
  h.get.mockResolvedValue({ ...page, items: [row] });
  await render(true);
  await click(action);
  expect(h.post).not.toHaveBeenCalled();
  await field("textarea", "Manager decision");
  await click(action);
  expect(h.post.mock.calls[0][1].body).toEqual({ action, reason: "Manager decision" });
});
it("keeps rejection available when approval is stale", async () => {
  h.user = "manager";
  currentTask = { ...task, version: 4 };
  h.get.mockResolvedValue({ ...page, items: [row] });
  await render(true);
  expect(button("approve")?.disabled).toBe(true);
  await field("textarea", "Please request again");
  await click("reject");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it.each(["submitted", "approved", "cancelled"] as const)(
  "does not request extensions during %s",
  async (status) => {
    currentTask = { ...task, status };
    await render();
    expect(button("request")).toBeUndefined();
  }
);
it("rejects missing reasons and deadlines before the current deadline", async () => {
  await render();
  await field("input", "2099-09-28T18:00");
  await click("request");
  expect(h.post).not.toHaveBeenCalled();
  await field("textarea", "Reason");
  await field("input", "2099-09-24T18:00");
  await click("request");
  expect(h.post).not.toHaveBeenCalled();
});
it("retries an ambiguous write with the same request UUID and payload", async () => {
  h.post.mockRejectedValueOnce(new Error("Connection lost"));
  await render();
  await field("textarea", "Original");
  await field("input", "2099-09-28T18:00");
  await click("request");
  const first = h.post.mock.calls[0];
  await click("request");
  expect(h.post).toHaveBeenCalledTimes(1);
  await click("retry");
  expect(h.post.mock.calls[1]).toEqual(first);
});
it("hides cached history after a denied read", async () => {
  h.get.mockResolvedValue({ ...page, items: [row] });
  await render();
  h.get.mockRejectedValue(new CrewApiError(403, { message: "Denied" }));
  await click("refresh");
  expect(host.textContent).not.toContain(row.reason);
  expect(button("withdraw")).toBeUndefined();
});
it("does not fetch history for an unrelated viewer", async () => {
  h.user = "other";
  await render();
  expect(h.get).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
});
it("isolates late writes from a switched account", async () => {
  let done!: () => void;
  h.post.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      })
  );
  await render();
  await field("textarea", "Old account");
  await field("input", "2099-09-28T18:00");
  await click("request");
  await click("request");
  expect(h.post).toHaveBeenCalledTimes(1);
  h.user = "manager";
  await render(true);
  const count = h.get.mock.calls.length;
  await act(async () => done());
  await flush();
  expect(h.get).toHaveBeenCalledTimes(count);
  expect(host.textContent).not.toContain("Old account");
});
it("uses the task-scoped history cursor", async () => {
  h.get.mockResolvedValueOnce({ items: [row], nextBeforeId: "request" }).mockResolvedValue({
    items: [{ ...row, id: "older", status: "rejected" }],
    nextBeforeId: null,
  });
  await render();
  await click("more");
  expect(h.get.mock.calls[1][1].query.beforeId).toBe("request");
  expect(host.querySelectorAll("article")).toHaveLength(2);
});

it("rechecks expiry at the moment a manager approves", async () => {
  h.user = "manager";
  h.get.mockResolvedValue({ ...page, items: [{ ...row, requestedDueAt: "2000-01-01T00:00:00Z" }] });
  await render(true);
  await field("textarea", "Reviewed");
  await click("approve");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("staleRequest");
});
