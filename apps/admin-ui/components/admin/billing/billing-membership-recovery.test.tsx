// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { BillingMembershipsPanel } from "./memberships-panel";
import type { BillingMembershipPlanRow } from "./types";
vi.mock("@/components/ui/data-table", () => ({
  DataTable: ({
    data,
    columns,
  }: {
    data: { id: string }[];
    columns: ColumnDef<{ id: string }>[];
  }) => (
    <div>
      {data.map((row) => (
        <div key={row.id}>
          {columns
            .filter((column) => column.id === "actions")
            .map((column) =>
              typeof column.cell === "function" ? (
                <div key={column.id}>
                  {column.cell({ row: { original: row } } as CellContext<{ id: string }, unknown>)}
                </div>
              ) : null
            )}
        </div>
      ))}
    </div>
  ),
}));
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
vi.mock("./shared", async (original) => ({
  ...(await original<typeof import("./shared")>()),
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
      <div role="dialog">
        {children}
        {footer}
        <button onClick={onClose}>Dismiss</button>
      </div>
    ) : null,
  Select: ({
    children,
    value,
    name,
    defaultValue,
    onChange,
  }: {
    children: ReactNode;
    value?: string;
    name?: string;
    defaultValue?: string;
    onChange?: (value: string) => void;
  }) => (
    <select
      name={name}
      defaultValue={defaultValue}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const props = { siteLabel: "Global", databaseLabel: "Fixture" };
const plan = (id: string) =>
  ({
    id,
    name: id,
    planKey: id,
    productType: "membership_plan",
    benefits: {},
    marketing: {},
    metadata: {},
    prices: [],
  }) as unknown as BillingMembershipPlanRow;
const view = () => (
  <BillingMembershipsPanel
    {...props}
    siteKey="global"
    initialPlans={{ items: [plan("first"), plan("second")] }}
  />
);
const benefits = {
  benefits: {
    queuePriority: 10,
    imageDaily: 5,
    videoDaily: 0,
    chatDaily: 30,
    workflowDaily: 3,
    uploadMB: 100,
    chatPerMinute: 20,
    concurrentJobs: 3,
    queuedJobs: 6,
  },
  issues: [],
};
function response(data: unknown = {}) {
  return { ok: true, json: () => Promise.resolve({ code: 200, data }) };
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
function click(text: string) {
  [...container.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === text)!
    .click();
}
function submit() {
  container
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("prevents duplicate plan creation and preserves failed input", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response({ items: [] }));
  await render(view());
  await act(async () => click("新建计划"));
  for (const input of container.querySelectorAll<HTMLInputElement>("input[required]"))
    input.value = "fixture";
  await act(async () => {
    submit();
    submit();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("form")?.hasAttribute("inert")).toBe(true);
  await act(async () => pending.reject(new Error("Plan unavailable")));
  expect(container.textContent).toContain("Plan unavailable");
  expect(container.querySelector<HTMLInputElement>('input[name="planKey"]')?.value).toBe("fixture");
  await act(async () => submit());
  expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
});
it("resets defaults when editing a different plan", async () => {
  await render(view());
  await act(async () => click("编辑"));
  const edits = [...container.querySelectorAll("button")].filter(
    (button) => button.textContent?.trim() === "编辑"
  );
  expect(container.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe("first");
  await act(async () => edits[1].click());
  expect(container.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe("second");
});
it("fences duplicate benefits saves and retains failure drafts", async () => {
  fetchMock.mockResolvedValueOnce(response(benefits));
  await render(view());
  await act(async () => click("权益"));
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise);
  await act(async () => {
    submit();
    submit();
  });
  expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(1);
  expect(container.querySelector("form")?.hasAttribute("inert")).toBe(true);
  await act(async () => pending.reject(new Error("Benefits save unavailable")));
  expect(container.textContent).toContain("Benefits save unavailable");
  expect(container.querySelector("form")?.hasAttribute("inert")).toBe(false);
});
it("cancels abandoned benefits reads and ignores delayed results", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view());
  await act(async () => click("权益"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => click("Dismiss"));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response(benefits)));
  expect(container.querySelector("form")).toBeNull();
});
it("suppresses a benefits save after the account is replaced", async () => {
  fetchMock.mockResolvedValueOnce(response(benefits));
  await render(view());
  await act(async () => click("权益"));
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise);
  await act(async () => submit());
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await render(view(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
