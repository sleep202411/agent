// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { IpEntitlementsPanel } from "./commerce-panels";
import type { IpEntitlementRow } from "./types";
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({ onConfirm }: { onConfirm: () => Promise<void> }) => {
    const [error, setError] = useState("");
    return (
      <div>
        <button
          onClick={() => {
            void onConfirm().catch((err: Error) => setError(err.message));
          }}
        >
          Confirm revoke
        </button>
        {error ? <span role="alert">{error}</span> : null}
      </div>
    );
  },
}));
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
const view = () => (
  <IpEntitlementsPanel
    {...props}
    initialEntitlements={{
      items: [
        { id: "one", status: "active" } as IpEntitlementRow,
        { id: "two", status: "active" } as IpEntitlementRow,
      ],
      nextCursor: "next",
    }}
    ips={null}
    initialError={null}
  />
);
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
it("prevents overlapping grants and retains failed fields", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue(response({ items: [], nextCursor: null }));
  await render(view());
  await input("用户 ID", "viewer");
  await input("IP ID", "ip");
  await act(async () => {
    click("补发权益");
    click("补发权益");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[inert]")).not.toBeNull();
  await act(async () => pending.reject(new Error("Grant unavailable")));
  expect(container.querySelector<HTMLInputElement>("#grant-user-id")?.value).toBe("viewer");
  await act(async () => click("补发权益"));
  expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(2);
});
it("fences revocations across rows and propagates failure to confirmation", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view());
  const controls = [...container.querySelectorAll("button")].filter(
    (button) => button.textContent?.trim() === "Confirm revoke"
  );
  await act(async () => {
    controls[0].click();
    controls[1].click();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("Revoke unavailable")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Revoke unavailable");
});
it("suppresses revocation refresh after session replacement", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view());
  await act(async () => click("Confirm revoke"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(view(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("does not append an old entitlement cursor to new filters", async () => {
  fetchMock.mockResolvedValue(response({ items: [], nextCursor: null }));
  await render(view());
  const field = container.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      field,
      "changed"
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => click("加载更多"));
  expect(fetchMock.mock.calls[0][0]).toContain("q=changed");
  expect(fetchMock.mock.calls[0][0]).not.toContain("cursor=");
});
it("retains failed pages and retries the same entitlement cursor", async () => {
  fetchMock
    .mockRejectedValueOnce(new Error("Page unavailable"))
    .mockResolvedValueOnce(response({ items: [], nextCursor: null }));
  await render(view());
  await act(async () => click("加载更多"));
  expect(container.textContent).toContain("one");
  await act(async () => click("加载更多"));
  expect(fetchMock.mock.calls[1][0]).toContain("cursor=next");
});
