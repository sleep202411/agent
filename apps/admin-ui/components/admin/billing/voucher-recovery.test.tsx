// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { BillingVouchersPanel } from "./vouchers-panel";
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant,
    size,
    asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
    asChild?: boolean;
  }) =>
    asChild ? (
      <span>{children}</span>
    ) : (
      <button {...props} data-variant={variant} data-size={size}>
        {children}
      </button>
    ),
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./shared", async (original) => ({
  ...(await original<typeof import("./shared")>()),
  AdminDialog: ({ children, title }: { children: ReactNode; title: string }) => (
    <div>
      {title}
      {children}
    </div>
  ),
  FormLabel: ({ children }: { children: ReactNode }) => <label>{children}</label>,
  Select: ({
    children,
    onChange,
    value,
  }: {
    children: ReactNode;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  ),
}));
vi.mock("@/components/ui/select", () => {
  const Wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Select: Wrap,
    SelectTrigger: Wrap,
    SelectContent: Wrap,
    SelectItem: Wrap,
    SelectValue: () => null,
  };
});
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fetchMock = vi.fn();
let root: Root | undefined;
let container: HTMLDivElement;
function response(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(data) };
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
const vouchers = () => (
  <BillingVouchersPanel
    siteKey="global"
    siteLabel="Global"
    databaseLabel="fixture"
    initialVouchers={{ items: [] }}
  />
);
function submitVoucher() {
  const form = container.querySelector("form")!;
  (form.elements.namedItem("count") as HTMLInputElement).value = "2";
  (form.elements.namedItem("computeCreditAmount") as HTMLInputElement).value = "500";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("claims voucher generation once and retains generated codes after a failed follow-up refresh", async () => {
  const request = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockReturnValueOnce(request.promise)
    .mockResolvedValueOnce(response({ code: 500, msg: "Refresh unavailable" }, false));
  await render(vouchers());
  await act(async () => {
    submitVoucher();
    submitVoucher();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  await act(async () =>
    request.resolve(
      response({ code: 200, data: { count: 2, vouchers: [{ code: "FIRST" }, { code: "SECOND" }] } })
    )
  );
  expect(container.textContent).toContain("已生成 2 个兑换码");
  expect(container.textContent).toContain("Refresh unavailable");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
});
it("aborts abandoned voucher generation and does not open its result in another session", async () => {
  const request = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(request.promise);
  await render(vouchers());
  await act(async () => submitVoucher());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(vouchers(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () =>
    request.resolve(response({ code: 200, data: { count: 1, vouchers: [{ code: "OLD" }] } }))
  );
  expect(container.textContent).not.toContain("已生成");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
