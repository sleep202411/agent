import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
import { orderKeys } from "@/app/(site)/creators/_hooks/use-orders";
const state = vi.hoisted(() => ({
  account: "buyer" as string | null,
  locale: "en-US",
  login: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.account ? { id: state.account } : null, isLoading: false }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => state.locale,
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: state.login }),
}));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({ onChange, ...props }: { onChange: (value: string) => void }) => (
    // eslint-disable-next-line no-restricted-syntax -- Test adapter; real themed controls are exercised in Chrome.
    <select {...props} onChange={(e) => onChange(e.target.value)} />
  ),
  NativeSelectOption: (props: object) => <option {...props} />,
}));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map([["creator", { nickname: "Storyboard artist" }]]),
}));
const order = {
  counterpartyId: "creator",
  id: "order-1",
  serviceTitle: "Storyboard package",
  status: "in_progress",
  packageTier: "basic",
  counterpartyRole: "creator",
  totalPrice: 120,
  currency: "USD",
  unreadCount: 2,
};
let root: Root, container: HTMLDivElement, client: QueryClient;
const fetchMock = vi.fn();
const tick = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
const render = () =>
  act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    )
  );
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.account = "buyer";
  state.locale = "en-US";
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});
it.each(["en-US", "zh-CN", "zh-HK"])(
  "lists orders with localized detail and return links (%s)",
  async (locale) => {
    state.locale = locale;
    fetchMock.mockResolvedValueOnce(Response.json({ items: [order], nextCursor: null }));
    await render();
    await tick();
    expect(container.textContent).toContain("Storyboard package");
    expect(container.textContent).toContain("Storyboard artist");
    expect(container.querySelector(`a[href='/${locale}/orders/order-1']`)).not.toBeNull();
    expect(container.querySelector(`a[href='/${locale}/messages']`)).not.toBeNull();
  }
);
it("filters by role and status through the server contract", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json({ items: [], nextCursor: null }))
  );
  await render();
  await tick();
  const selects = container.querySelectorAll("select");
  await act(async () => {
    selects[0]!.value = "creator";
    selects[0]!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await tick();
  await act(async () => {
    selects[1]!.value = "delivered";
    selects[1]!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await tick();
  expect(fetchMock.mock.lastCall?.[0]).toContain("role=creator&status=delivered");
});
it("retains the first page and retries a failed next page without duplicates", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ items: [order], nextCursor: "cursor-1" }));
  await render();
  await tick();
  fetchMock.mockResolvedValueOnce(Response.json({ message: "Try later" }, { status: 503 }));
  await act(async () => button("list.loadMore").click());
  await tick();
  expect(container.textContent).toContain("Storyboard package");
  expect(container.textContent).toContain("Storyboard artist");
  expect(container.textContent).toContain("Try later");
  fetchMock.mockResolvedValueOnce(
    Response.json({
      items: [order, { ...order, id: "order-2", serviceTitle: "Second package" }],
      nextCursor: null,
    })
  );
  await act(async () => button("retry").click());
  await tick();
  expect(fetchMock.mock.lastCall?.[0]).toContain("cursor=cursor-1");
  expect(container.querySelectorAll("li")).toHaveLength(2);
  expect(button("list.loadMore")).toBeUndefined();
});
it("removes cached orders when access is revoked", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ items: [order], nextCursor: null }));
  await render();
  await tick();
  fetchMock.mockResolvedValueOnce(Response.json({ message: "Access revoked" }, { status: 403 }));
  await act(async () => {
    await client.invalidateQueries({ queryKey: orderKeys.lists() });
  });
  await tick();
  expect(container.textContent).toContain("Access revoked");
  expect(container.textContent).not.toContain("Storyboard package");
});
it("clears another account's orders and offers sign-in when logged out", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ items: [order], nextCursor: null }));
  await render();
  await tick();
  state.account = "other";
  fetchMock.mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }));
  await render();
  await tick();
  expect(container.textContent).not.toContain("Storyboard package");
  state.account = null;
  await render();
  await act(async () => button("signIn").click());
  expect(state.login).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
