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
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "order-1" }) }));
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
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({ useUserDisplays: () => new Map() }));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("./action-footer", () => ({ ActionFooter: () => <div>Order actions</div> }));
vi.mock("@/app/(site)/messages/_components/conversation-view", () => ({
  ConversationView: () => <div>Private conversation</div>,
}));
const order = {
  id: "order-1",
  buyerId: "buyer",
  creatorId: "creator",
  status: "in_progress",
  conversationId: "chat",
  packageSnapshot: {
    title: "Private package",
    price: 100,
    currency: "USD",
    tier: "basic",
    deliveryDays: 3,
    revisions: 1,
    scope: [],
  },
  questionnaire: [],
  bindings: {},
  createdAt: "2026-10-01",
};
let root: Root, container: HTMLDivElement, client: QueryClient;
const fetchMock = vi.fn();
const response = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
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
  "recovers failed reads with a localized return path (%s)",
  async (locale) => {
    state.locale = locale;
    fetchMock.mockResolvedValueOnce(response(503, { message: "Order service unavailable" }));
    await render();
    await tick();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Order service unavailable"
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(`/${locale}/orders`);
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    await act(async () => button("retry").click());
    await tick();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("loading");
    expect(button("retry")).toBeUndefined();
    await act(async () => resolve(response(200, order)));
    await tick();
    expect(container.textContent).toContain("Private package");
    expect(container.textContent).toContain("Order actions");
  }
);
it("removes cached private content when a refetch denies access", async () => {
  fetchMock.mockResolvedValueOnce(response(200, order));
  await render();
  await tick();
  expect(container.textContent).toContain("Private conversation");
  fetchMock.mockResolvedValueOnce(response(403, { message: "Order access revoked" }));
  await act(async () => {
    await client.invalidateQueries({ queryKey: orderKeys.detail("order-1", "buyer") });
  });
  await tick();
  expect(container.textContent).toContain("Order access revoked");
  expect(container.textContent).not.toContain("Private package");
  expect(container.textContent).not.toContain("Private conversation");
  expect(container.textContent).not.toContain("Order actions");
});
it("offers sign-in without fetching or spinning when signed out", async () => {
  state.account = null;
  await render();
  expect(container.textContent).toContain("signInRequired");
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => button("signIn").click());
  expect(state.login).toHaveBeenCalledOnce();
});
it("does not treat an unrelated account as the creator", async () => {
  state.account = "stranger";
  fetchMock.mockResolvedValueOnce(response(200, order));
  await render();
  await tick();
  expect(container.textContent).toContain("unavailable");
  expect(container.textContent).not.toContain("Order actions");
});
