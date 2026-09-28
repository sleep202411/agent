// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { BillingCampaignsPanel } from "./campaigns-panel";
import { BillingEventsPanel } from "./events-panel";
import { BillingCheckInPanel } from "./check-in-panel";
import type { BillingProviderEventRow } from "./types";
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
const campaigns = () => <BillingCampaignsPanel {...props} initialCampaigns={{ items: [] }} />;
const checkIn = () => (
  <BillingCheckInPanel
    {...props}
    initialConfig={{ configured: true, enabled: true, rewards: [10, 20], updatedAt: null }}
  />
);
const events = () => (
  <BillingEventsPanel
    {...props}
    initialProviderEvents={{
      items: [
        { id: "one", status: "failed" },
        { id: "two", status: "failed" },
      ] as BillingProviderEventRow[],
      nextCursor: null,
    }}
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
function submit() {
  const name = container.querySelector<HTMLInputElement>('input[name="name"]');
  if (name) name.value = "Fixture campaign";
  const amount = container.querySelector<HTMLInputElement>('input[name="computeCreditAmount"]');
  if (amount) amount.value = "20";
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
it.each([campaigns, checkIn])(
  "claims form mutations once and retains failures for retry",
  async (view) => {
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(response({ items: [], updatedAt: null }));
    await render(view());
    await act(async () => {
      submit();
      submit();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLButtonElement>('form button[type="submit"]')?.disabled).toBe(
      true
    );
    await act(async () => pending.reject(new Error("Save unavailable")));
    expect(container.textContent).toContain("Save unavailable");
    expect(container.querySelector<HTMLButtonElement>('form button[type="submit"]')?.disabled).toBe(
      false
    );
    await act(async () => submit());
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  }
);
it.each([campaigns, checkIn])(
  "suppresses accepted form responses after account replacement",
  async (view) => {
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValue(pending.promise);
    await render(view());
    await act(async () => submit());
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await render(view(), "bob");
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(response({ updatedAt: "2026-09-14T00:00:00Z" })));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("已保存");
  }
);
it("prevents provider operations on different rows from overlapping", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(events());
  const buttons = [...container.querySelectorAll("button")].filter((button) =>
    button.textContent?.includes("重放")
  );
  await act(async () => {
    buttons[0].click();
    buttons[1].click();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await render(events(), "bob");
  await act(async () => pending.reject(new Error("Old provider failure")));
  expect(container.textContent).not.toContain("Old provider failure");
});
it("refreshes provider events with the current filter after a row action", async () => {
  fetchMock
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response({ items: [], nextCursor: null }));
  await render(events());
  const provider = container.querySelectorAll("select")[1];
  await act(async () => {
    provider.value = "airwallex";
    provider.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("重放"))!
      .click()
  );
  expect(fetchMock.mock.calls[1][0]).toContain("provider=airwallex");
});
