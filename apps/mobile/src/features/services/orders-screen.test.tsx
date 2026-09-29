import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import OrdersScreen from "@/app/orders";
vi.mock("@/features/services/user-displays", () => ({ useUserDisplays: () => new Map() }));
const h = vi.hoisted(() => ({
  push: vi.fn(),
  gate: vi.fn(),
  useOrders: vi.fn(),
  authenticated: true,
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: h.push }),
  useIsFocused: () => true,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.authenticated ? "authenticated" : "anonymous", generation: 7 }),
  useAuthGate: () => ({ requireAuth: h.gate }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
vi.mock("@/features/services/use-orders", () => ({ useOrders: h.useOrders }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  FlatList: ({
    data,
    renderItem,
    ListEmptyComponent,
    ListFooterComponent,
  }: {
    data: { id: string }[];
    renderItem: (arg: { item: { id: string } }) => ReactNode;
    ListEmptyComponent: ReactNode;
    ListFooterComponent: ReactNode;
  }) => (
    <div>
      {data.length
        ? data.map((item) => <div key={item.id}>{renderItem({ item })}</div>)
        : ListEmptyComponent}
      {ListFooterComponent}
    </div>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const render = () => act(async () => root.render(<OrdersScreen />));
const click = (label: string) =>
  act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === label)!
      .click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.authenticated = true;
  h.useOrders.mockReturnValue({
    items: [],
    loading: false,
    loadMore: vi.fn(),
    refresh: vi.fn(),
    retry: vi.fn(),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("wires native filters and order navigation", async () => {
  await render();
  await click("orders.role.creator");
  await click("orders.status.delivered");
  expect(h.useOrders).toHaveBeenLastCalledWith("7", "creator", "delivered");
  h.useOrders.mockReturnValue({
    items: [
      {
        id: "a/b",
        serviceTitle: "Film",
        status: "delivered",
        totalPrice: 12,
        currency: "USD",
        unreadCount: 1,
      },
    ],
    loading: false,
  });
  await render();
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent?.startsWith("Film"))!
      .click()
  );
  expect(h.push).toHaveBeenCalledWith("/order/a%2Fb");
});
it("defers guest authentication to intent and never passes an authenticated scope", async () => {
  h.authenticated = false;
  await render();
  expect(h.useOrders).toHaveBeenLastCalledWith(undefined, "both", "");
  await click("orders.signIn");
  expect(h.gate).toHaveBeenCalledOnce();
});
