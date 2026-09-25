import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskClosureControl } from "./task-closure-control";
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
vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");
  const Context = React.createContext({
    open: false,
    onOpenChange: (value: boolean) => {
      void value;
    },
  });
  return {
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (value: boolean) => void;
      children: import("react").ReactNode;
    }) => <Context.Provider value={{ open, onOpenChange }}>{children}</Context.Provider>,
    PopoverTrigger: ({
      children,
    }: {
      children: import("react").ReactElement<{ onClick?: () => void }>;
    }) => {
      const value = React.useContext(Context);
      return React.cloneElement(children, { onClick: () => value.onOpenChange(!value.open) });
    },
    PopoverContent: ({ children }: { children: import("react").ReactNode }) =>
      React.useContext(Context).open ? <div>{children}</div> : null,
  };
});
const task = {
  id: "task",
  crewId: "crew",
  version: 3,
  status: "in_progress",
} as unknown as import("../_hooks/types").CrewTaskDTO;
let currentTask = task;
const page = {};
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
async function render(canManage = true) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <TaskClosureControl task={currentTask} canManage={canManage} />
      </QueryClientProvider>
    )
  );
  await flush();
}
async function toggle() {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="title"]')!.click());
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

it("requires a reason and explicit confirmation before cancellation", async () => {
  await render();
  await toggle();
  expect(h.post).not.toHaveBeenCalled();
  expect(button("confirm")?.disabled).toBe(true);
  await field("textarea", "Project direction changed");
  expect(h.post).not.toHaveBeenCalled();
  await click("confirm");
  expect(h.post.mock.calls[0][0]).toBe("/crew-tasks/task/close");
  expect(h.post.mock.calls[0][1].body).toMatchObject({
    expectedVersion: 3,
    reason: "Project direction changed",
  });
  expect(h.post.mock.calls[0][1].body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(host.textContent).toContain("done");
});
it("keeps an old draft stale across closing and reopening the popover", async () => {
  await render();
  await toggle();
  await field("textarea", "Original reason");
  await toggle();
  currentTask = { ...task, version: 4 };
  await render();
  await toggle();
  expect(host.querySelector("textarea")?.value).toBe("Original reason");
  expect(button("confirm")?.disabled).toBe(true);
  await click("discard");
  expect(host.querySelector("textarea")?.value).toBe("");
  await field("textarea", "Reviewed version four");
  await click("confirm");
  expect(h.post.mock.calls[0][1].body.expectedVersion).toBe(4);
});
it.each(["submitted", "approved", "cancelled"] as const)(
  "hides new closure for %s work",
  async (status) => {
    currentTask = { ...task, status };
    await render();
    expect(host.textContent).toBe("");
    expect(h.post).not.toHaveBeenCalled();
  }
);
it("does not offer closure to a non-manager", async () => {
  await render(false);
  expect(host.textContent).toBe("");
});
it("recovers the exact uncertain closure even after the task becomes cancelled", async () => {
  h.post.mockRejectedValueOnce(new Error("Connection lost"));
  await render();
  await toggle();
  await field("textarea", "Original closure");
  await click("confirm");
  const original = h.post.mock.calls[0];
  currentTask = { ...task, status: "cancelled", version: 4 };
  await render();
  expect(button("confirm")).toBeUndefined();
  await click("retry");
  expect(h.post.mock.calls[1]).toEqual(original);
});
it("preserves a definitively rejected draft for correction", async () => {
  h.post.mockRejectedValueOnce(new CrewApiError(409, { message: "Task changed" }));
  await render();
  await toggle();
  await field("textarea", "Reason");
  await click("confirm");
  expect(host.textContent).toContain("Task changed");
  expect(button("retry")).toBeUndefined();
  expect(host.querySelector("textarea")?.value).toBe("Reason");
});
it("suppresses duplicate writes and late effects after account switch", async () => {
  let finish!: () => void;
  h.post.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await toggle();
  await field("textarea", "Old account");
  await click("confirm");
  await click("confirm");
  expect(h.post).toHaveBeenCalledTimes(1);
  h.user = "other";
  await render();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  await act(async () => finish());
  await flush();
  expect(invalidate).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("done");
  await toggle();
  expect(host.querySelector("textarea")?.value).toBe("");
});
it("does not turn a successful closure into a new request when refresh fails", async () => {
  vi.spyOn(qc, "invalidateQueries").mockRejectedValue(new Error("Refresh failed"));
  await render();
  await toggle();
  await field("textarea", "Reason");
  await click("confirm");
  expect(host.textContent).toContain("done");
  expect(button("retry")).toBeUndefined();
  expect(h.post).toHaveBeenCalledTimes(1);
});
