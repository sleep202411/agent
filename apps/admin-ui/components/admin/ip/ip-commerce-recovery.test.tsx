// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { IpOrdersPanel } from "./commerce-panels";
import { IpRevenuePanel } from "./revenue-panel";
import { IpReviewsPanel, IpReportsPanel } from "./governance-panels";
import type { IpPurchaseOrderRow, AdminRevenueEntryRow } from "./types";
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
          <span>{row.id}</span>
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
vi.mock("../billing/shared", async (original) => ({
  ...(await original<typeof import("../billing/shared")>()),
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
const orders = () => (
  <IpOrdersPanel
    {...props}
    initialOrders={{ items: [{ id: "saved-order" } as IpPurchaseOrderRow], nextCursor: "next" }}
    initialError={null}
  />
);
const revenue = () => (
  <IpRevenuePanel
    {...props}
    initialSettings={{ creatorRevenueShareBps: 7000, settings: [] }}
    initialEntries={{
      items: [{ id: "saved-entry", orderId: "order" } as AdminRevenueEntryRow],
      nextCursor: "next",
    }}
    initialError={null}
  />
);
const reviews = () => <IpReviewsPanel {...props} overview={null} error={null} />;
const reports = () => <IpReportsPanel {...props} overview={null} error={null} />;
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
async function input(placeholder: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it.each([orders, revenue, reviews, reports])(
  "cancels abandoned refreshes and suppresses late errors",
  async (view) => {
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValue(pending.promise);
    await render(view());
    await act(async () => click("刷新"));
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await render(view(), "bob");
    expect(signal.aborted).toBe(true);
    await act(async () => pending.reject(new Error("Old read error")));
    expect(container.textContent).not.toContain("Old read error");
  }
);
it.each([orders, revenue])(
  "refreshes instead of appending an old cursor after a filter edit",
  async (view) => {
    fetchMock.mockResolvedValue(response({ items: [], nextCursor: null }));
    await render(view());
    const field = container.querySelector<HTMLInputElement>(
      view === revenue ? 'input[placeholder="IP ID"]' : "input"
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        field,
        "new-filter"
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => click("加载更多"));
    expect(fetchMock.mock.calls[0][0]).toContain("new-filter");
    expect(fetchMock.mock.calls[0][0]).not.toContain("cursor=");
  }
);
it.each([orders, revenue])("keeps loaded records after a failed next page", async (view) => {
  fetchMock
    .mockRejectedValueOnce(new Error("Next page unavailable"))
    .mockResolvedValueOnce(response({ items: [], nextCursor: null }));
  await render(view());
  await act(async () => click("加载更多"));
  expect(container.textContent).toContain(view === orders ? "saved-order" : "saved-entry");
  expect(container.textContent).toContain("Next page unavailable");
  await act(async () => click("加载更多"));
  expect(fetchMock.mock.calls[1][0]).toContain("cursor=next");
});
it("cancels dismissed order breakdowns without late data", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise);
  await render(orders());
  await act(async () => click("查看分账"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => click("Dismiss"));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it("prevents duplicate default-share saves and retains failure drafts", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise);
  await render(revenue());
  await input("例如 70", "65");
  await act(async () => {
    click("保存默认比例");
    click("保存默认比例");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("Share unavailable")));
  expect(container.querySelector<HTMLInputElement>("#default-share")?.value).toBe("65");
  expect(container.textContent).toContain("Share unavailable");
});
