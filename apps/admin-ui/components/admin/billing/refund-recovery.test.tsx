// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { BillingRefundsPanel } from "./refunds-panel";
import type { BillingRefundQuoteData } from "./types";
vi.mock("@/components/ui/data-table", () => ({
  DataTable: ({ data }: { data: unknown }) => <div data-testid="rows">{JSON.stringify(data)}</div>,
}));
vi.mock("./shared", async (original) => ({
  ...(await original<object>()),
  RefundQuotePanel: ({ quote }: { quote: BillingRefundQuoteData | null }) => (
    <div>{quote ? "Quote ready" : "No quote"}</div>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const quote = {
  order: { id: "order" },
  blockers: [],
  policy: { calculationMode: "suggested" },
  requestedAmountMinor: "100",
};
const response = (data: unknown) => ({
  ok: true,
  json: () => Promise.resolve({ code: 200, data }),
});
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  let reject!: (value: Error) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(scope = "one") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={scope}>
        <BillingRefundsPanel siteLabel="Test" databaseLabel="Local" initialRefunds={null} />
      </AdminSessionBoundary>
    )
  );
}
function button(text: string) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
}
function submit() {
  container
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
async function evaluate() {
  container.querySelector<HTMLInputElement>('[name="orderId"]')!.value = "order";
  await act(async () => button("评估退款").click());
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("reuses the request identity after response loss and resets the captured form only after acceptance", async () => {
  const pending = deferred();
  fetchMock
    .mockResolvedValueOnce(response(quote))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(response({}))
    .mockResolvedValueOnce(response({ items: [], nextCursor: null }));
  await render();
  await evaluate();
  expect(container.textContent).toContain("Quote ready");
  await act(async () => {
    submit();
    submit();
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const key = container.querySelector<HTMLInputElement>('[name="idempotencyKey"]')!.value;
  expect(key).not.toBe("");
  await act(async () => pending.reject(new Error("Response lost")));
  expect(container.textContent).toContain("Response lost");
  await act(async () => submit());
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).idempotencyKey).toBe(key);
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(container.querySelector<HTMLInputElement>('[name="orderId"]')!.value).toBe("");
  expect(container.textContent).toContain("No quote");
});
it("does not accept a previous quote after details change", async () => {
  fetchMock.mockResolvedValue(response(quote));
  await render();
  await evaluate();
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('[name="orderId"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "other");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("No quote");
  await act(async () => submit());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Evaluate the current");
});
it("cancels abandoned quotes and ignores their late results", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise);
  await render();
  await evaluate();
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("two");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response(quote)));
  expect(container.textContent).toContain("No quote");
  expect(button("提交退款").disabled).toBe(true);
});
it("accepted refunds do not leave a resubmittable quote when list refresh fails", async () => {
  fetchMock
    .mockResolvedValueOnce(response(quote))
    .mockResolvedValueOnce(response({}))
    .mockRejectedValueOnce(new Error("List unavailable"));
  await render();
  await evaluate();
  await act(async () => submit());
  expect(container.textContent).toContain("List unavailable");
  expect(button("提交退款").disabled).toBe(true);
  expect(container.querySelector<HTMLInputElement>('[name="orderId"]')!.value).toBe("");
});

it("cancels abandoned refund history reads and suppresses late pages", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => button("应用").click());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("other");
  expect(signal.aborted).toBe(true);
  await act(async () =>
    pending.resolve(response({ items: [{ id: "private-old-page" }], nextCursor: null }))
  );
  expect(container.textContent).not.toContain("private-old-page");
});
