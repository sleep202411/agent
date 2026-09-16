// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { BillingOrdersPanel } from "./orders-panel";
import { BillingSettlementsPanel } from "./settlements-panel";
import { BillingLedgerPanel } from "./ledger-panel";
import { emptyLedgerOverview } from "./types";
vi.mock("@/components/ui/data-table", () => ({
  DataTable: ({ data }: { data: unknown }) => <div>{JSON.stringify(data)}</div>,
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
  Select: ({
    children,
    value,
    onChange,
  }: {
    children: ReactNode;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {children}
    </select>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const props = { siteLabel: "Global", databaseLabel: "Fixture" };
const panels = {
  orders: () => <BillingOrdersPanel {...props} initialOrders={null} />,
  settlements: () => <BillingSettlementsPanel {...props} initialSettlements={null} />,
  ledger: () => (
    <BillingLedgerPanel {...props} initialLedgerOverview={null} initialLedgerJournals={null} />
  ),
};
function response(data: unknown) {
  return { ok: true, json: () => Promise.resolve({ code: 200, data }) };
}
function loaded(url: string) {
  return response(
    url.includes("/overview")
      ? emptyLedgerOverview
      : { items: [{ id: "loaded-record" }], nextCursor: null }
  );
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
function refresh() {
  [...container.querySelectorAll("button")]
    .find((button) => /刷新|应用/.test(button.textContent ?? ""))!
    .click();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it.each(Object.keys(panels) as (keyof typeof panels)[])(
  "retains %s records after failure and recovers on explicit retry",
  async (kind) => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(loaded(url)));
    await render(panels[kind]());
    await act(async () => refresh());
    expect(container.textContent).toContain("loaded-record");
    fetchMock.mockRejectedValue(new Error("Read unavailable"));
    await act(async () => refresh());
    expect(container.textContent).toContain("loaded-record");
    expect(container.textContent).toContain("Read unavailable");
    fetchMock.mockImplementation((url: string) => Promise.resolve(loaded(url)));
    await act(async () => refresh());
    expect(container.textContent).not.toContain("Read unavailable");
  }
);
it.each(Object.keys(panels) as (keyof typeof panels)[])(
  "cancels abandoned %s reads and suppresses old session errors",
  async (kind) => {
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValue(pending.promise);
    await render(panels[kind]());
    await act(async () => refresh());
    const signals = fetchMock.mock.calls.map((call) => call[1].signal as AbortSignal);
    await render(panels[kind](), "bob");
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await act(async () => pending.reject(new Error("Old session error")));
    expect(container.textContent).not.toContain("Old session error");
  }
);
it("cancels the ledger companion request when one read fails", async () => {
  fetchMock.mockImplementation((url: string) =>
    url.includes("overview") ? Promise.reject(new Error("Overview failed")) : new Promise(() => {})
  );
  await render(panels.ledger());
  await act(async () => refresh());
  expect(fetchMock.mock.calls.every((call) => (call[1].signal as AbortSignal).aborted)).toBe(true);
  expect(container.textContent).toContain("Overview failed");
});
it("supersedes a same-tick orders refresh without accepting its delayed result", async () => {
  const old = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(response({ items: [{ id: "new-record" }] }));
  await render(panels.orders());
  await act(async () => {
    refresh();
    refresh();
  });
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => old.resolve(response({ items: [{ id: "old-record" }] })));
  expect(container.textContent).toContain("new-record");
  expect(container.textContent).not.toContain("old-record");
});
