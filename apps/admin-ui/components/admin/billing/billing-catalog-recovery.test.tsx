// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { BillingCatalogPanel } from "./catalog-panel";
import { BillingPromotionsPanel } from "./promotions-panel";
import type { BillingPriceRow, BillingPromotionRow } from "./types";
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
const catalog = () => (
  <BillingCatalogPanel
    {...props}
    siteKey="global"
    initialPrices={{
      items: [
        {
          id: "price",
          name: "Fixture price",
          productType: "compute_point_pack",
          providerBindings: [],
          metadata: {},
          amountMinor: "100",
          currency: "USD",
        } as unknown as BillingPriceRow,
      ],
    }}
  />
);
const cnCatalog = () => (
  <BillingCatalogPanel {...props} siteKey="cn" initialPrices={{ items: [] }} />
);
const promotions = () => (
  <BillingPromotionsPanel
    {...props}
    siteKey="global"
    initialPromotions={{
      items: [
        {
          id: "promotion",
          name: "Fixture promotion",
          status: "draft",
          providerBindings: [],
        } as unknown as BillingPromotionRow,
      ],
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
async function openCreate(view: typeof catalog | typeof promotions) {
  await render(view());
  if (view === catalog) await act(async () => click("新建套餐"));
  for (const input of container.querySelectorAll<HTMLInputElement>("input[required]"))
    input.value = "10";
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it.each([catalog, promotions])(
  "excludes duplicate creates and preserves failed forms",
  async (view) => {
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response({ items: [] }));
    await openCreate(view);
    const form = container.querySelector("form")!;
    await act(async () => {
      submit();
      submit();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector("form")?.hasAttribute("inert")).toBe(true);
    await act(async () => pending.reject(new Error("Create unavailable")));
    expect(container.textContent).toContain("Create unavailable");
    expect(container.querySelector("form")).toBe(form);
    await act(async () => submit());
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  }
);
it.each([catalog, promotions])("cancels abandoned creates without a late refresh", async (view) => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await openCreate(view);
  await act(async () => submit());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(view(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("applies a catalog filter selected during an active save after it finishes", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response({ items: [] }));
  await openCreate(catalog);
  await act(async () => submit());
  const provider = container.querySelector("select")!;
  await act(async () => {
    provider.value = "airwallex";
    provider.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(response()));
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("provider=airwallex");
});
it("uses the current promotion filters for row status refreshes", async () => {
  fetchMock.mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ items: [] }));
  await render(promotions());
  const provider = container.querySelectorAll("select")[1];
  await act(async () => {
    provider.value = "airwallex";
    provider.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    click("启用");
    click("暂停");
  });
  expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "PATCH")).toHaveLength(1);
  expect(fetchMock.mock.calls[1][0]).toContain("provider=airwallex");
});

it("creates a CN WeChat package without a client-owned synchronization status", async () => {
  fetchMock.mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ items: [] }));
  await render(cnCatalog());
  await act(async () => click("新建套餐"));

  const productType = container.querySelector<HTMLSelectElement>('select[name="productType"]')!;
  await act(async () => {
    productType.value = "community_point_pack";
    productType.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const values: Record<string, string> = {
    itemName: "5,000 社区积分",
    amountMinor: "35000",
    grantsWalletAmount: "5000",
  };
  await act(async () => {
    for (const [name, value] of Object.entries(values)) {
      const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  await act(async () => submit());

  const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(payload).toMatchObject({
    productType: "community_point_pack",
    currency: "CNY",
    grantsWalletCurrency: "community_point",
    providerBindings: [{ provider: "wechat_pay" }],
  });
  expect(payload.providerBindings[0]).not.toHaveProperty("status");
});
