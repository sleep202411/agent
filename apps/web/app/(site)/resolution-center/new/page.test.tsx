import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
const state = vi.hoisted(() => ({
  user: { id: "creator" } as { id: string } | null,
  get: vi.fn(),
  search: vi.fn(),
  purchases: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.user, isLoading: false }),
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, values?: { id?: string }) =>
    values?.id ? `${key}:${values.id}` : key,
}));
vi.mock("../../crews/_hooks/api", () => ({ crewApi: { get: state.get } }));
vi.mock("../../crews/_hooks/use-tasks", () => ({ useCrewTask: () => ({ data: null }) }));
vi.mock("../../crews/_components/task-dispute-control", () => ({ TaskDisputeControl: () => null }));
vi.mock("@/src/lib/ip-commerce/api", () => ({
  listIpCommerceIps: (...args: unknown[]) => state.search(...args),
  listMyReportPurchases: (...args: unknown[]) => state.purchases(...args),
  reportIpContent: (...args: unknown[]) => state.submit(...args),
}));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({
    onChange,
    children,
    ...props
  }: {
    onChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    // NativeSelect test double: exercise value callbacks without portal behavior.
    // eslint-disable-next-line no-restricted-syntax
    <select {...props} onChange={(event) => onChange(event.target.value)}>
      {children}
    </select>
  ),
  NativeSelectOption: ({ children, ...props }: { children: React.ReactNode }) => (
    <option {...props}>{children}</option>
  ),
}));
let client: QueryClient, root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.user = { id: "creator" };
  state.purchases
    .mockReset()
    .mockResolvedValue({
      items: [
        {
          id: "purchase-1",
          orderNo: "ORDER-001",
          ipId: "ip-1",
          episodeId: "episode-1",
          targetType: "episode",
          currency: "community_point",
          totalAmount: "9007199254740993",
          status: "fulfilled",
        },
      ],
      nextCursor: null,
    });
  state.search.mockReset().mockResolvedValue({
    items: [{ id: "ip-1", title: "Fixture IP", roomNumber: "123" }],
    nextCursor: null,
  });
  state.submit.mockReset().mockResolvedValue({ report: { id: "report-1", status: "submitted" } });
  state.get.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it("submits the explicit search to the authorized task endpoint and offers the content-report route", async () => {
  await render();
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>("#case-record-search")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "  income-code  "
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(state.get).toHaveBeenCalledTimes(1);
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(state.get).toHaveBeenLastCalledWith(
    "/crew-task-center",
    expect.objectContaining({
      query: expect.objectContaining({ query: "income-code", scope: "mine", status: "all" }),
    })
  );
  expect(
    [...host.querySelectorAll("button")].some(
      (button) => button.textContent === "contentRecordType"
    )
  ).toBe(true);
  expect(host.textContent).toContain("noMatchingTasks");
  state.user = { id: "other" };
  await render();
  expect(host.querySelector<HTMLInputElement>("#case-record-search")!.value).toBe("");
  expect(state.get.mock.calls.at(-1)?.[1].query.query).toBeUndefined();
});
it("does not query private task choices when signed out", async () => {
  state.user = null;
  await render();
  expect(state.get).not.toHaveBeenCalled();
  expect(host.textContent).toContain("signIn");
});

async function click(label: string) {
  await act(async () => {
    [...host.querySelectorAll("button")].find((button) => button.textContent === label)!.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function fillContentReport() {
  await click("contentRecordType");
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="target"]')!;
    select.value = "ip-1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const description = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      description,
      "Private report draft"
    );
    description.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("keeps a content draft when switching record types and submits through the existing IP report contract", async () => {
  await render();
  expect(state.search).not.toHaveBeenCalled();
  await fillContentReport();
  await click("taskRecordType");
  await click("contentRecordType");
  expect(host.querySelector("textarea")!.value).toBe("Private report draft");
  await act(async () =>
    host
      .querySelector("textarea")!
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(state.submit).toHaveBeenCalledWith({
    requestId: expect.any(String),
    targetType: "ip",
    targetId: "ip-1",
    reason: "copyright",
    description: "Private report draft",
  });
  expect(host.textContent).toContain("contentReportSubmitted:report-1");
  expect(host.querySelector('a[href="/en-US/resolution-center/content"]')).not.toBeNull();
});
it("ignores a previous account's late content-report response", async () => {
  let finish!: (value: { report: { id: string; status: string } }) => void;
  state.submit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await fillContentReport();
  await act(async () =>
    host
      .querySelector("textarea")!
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  state.user = { id: "other" };
  await render();
  await act(async () =>
    finish({ report: { id: "private-previous-account", status: "submitted" } })
  );
  expect(host.textContent).not.toContain("private-previous-account");
  expect(host.querySelector("textarea")).toBeNull();
});

it("preserves an owned purchase draft and retries an ambiguous submission with the same identity", async () => {
  state.submit.mockRejectedValueOnce(new Error("Connection interrupted"));
  await render();
  expect(state.purchases).not.toHaveBeenCalled();
  await click("purchaseRecordType");
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="purchaseTarget"]')!;
    select.value = "purchase-1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("taskRecordType");
  await click("purchaseRecordType");
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="purchaseTarget"]')!.value).toBe(
    "purchase-1"
  );
  const submit = async () =>
    act(async () =>
      host
        .querySelector("textarea")!
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
  await submit();
  expect(host.textContent).toContain("Connection interrupted");
  const first = state.submit.mock.calls[0][0];
  expect(first).toEqual({
    requestId: expect.any(String),
    purchaseOrderId: "purchase-1",
    targetType: "episode",
    targetId: "episode-1",
    reason: "payment",
    description: undefined,
  });
  await submit();
  expect(state.submit.mock.calls[1][0]).toEqual(first);
  expect(host.textContent).toContain("contentReportSubmitted:report-1");
});
