import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpCommercePanel } from "./commerce-panel";
const h = vi.hoisted(() => ({
  signedIn: true,
  active: true,
  generation: 1,
  get: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  push: vi.fn(),
  key: 10,
  open: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, patch: h.patch, post: h.post, delete: h.del },
  ApiRequestError: class extends Error {
    status: number;
    constructor(_code: string, message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => `00000000-0000-4000-8000-${String(++h.key).padStart(12, "0")}` },
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <div>web:{path}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      readOnly={!editable}
      aria-label={accessibilityLabel}
    />
  ),
}));

vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: vi.fn() }));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <div>Video preview</div>,
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ push: h.push }),
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) => (
      <>{options.headerRight?.()}</>
    ),
  },
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.signedIn ? "authenticated" : "anonymous",
    user: { userId: "alice" },
    generation: 1,
  }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/features/ip-author/contributors-panel", () => ({ IpContributorsPanel: () => null }));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const reference = { id, title: "Story", status: "published" };
const fixture = () => ({
  ip: reference,
  metrics: {
    totalOrders: 1,
    recognizedOrders: 1,
    grossCommunityPoints: "9007199254740993123",
    ordersLast7Days: 1,
    grossCommunityPointsLast7Days: "4",
    uniqueBuyers: 1,
    activeEntitlements: 1,
    pendingUnlocks: 0,
  },
  pricingHealth: {
    status: "attention",
    bundlePriceActive: false,
    activeEpisodePriceCount: 0,
    pricedEpisodeCount: 0,
    publishedEpisodeCount: 1,
    freePreviewEpisodeCount: 0,
    warnings: [{ code: "new_warning", severity: "warning", message: "Review schedule" }],
  },
  settlement: {
    status: "active",
    currency: "community_point",
    saleShareBps: 3500,
    ipLifetimeEarnings: "50",
    withdrawableBalance: "100",
    note: "Cash-out is coming soon.",
  },
  recentOrders: [
    {
      id: other,
      ipId: id,
      episodeId: null,
      orderNo: "IP-001",
      status: "paid",
      targetType: "ip",
      currency: "community_point",
      totalAmount: "100",
      createdAt: "2026-10-01T03:00:00Z",
      ip: reference,
      episode: null,
    },
  ],
});
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () => root.render(<IpCommercePanel ipId={id} userId="alice" generation={1} />));
const refresh = () =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "thread.refresh")!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.generation = 1;
  h.get.mockResolvedValue(fixture());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("shows exact balances, IP earnings, pool share, pricing health and order status", async () => {
  await mount();
  expect(host.textContent).toContain("9,007,199,254,740,993,123");
  expect(host.textContent).toContain("ipCommerce.ownerBalance: 100");
  expect(host.textContent).toContain("ipCommerce.ipEarnings: 50");
  expect(host.textContent).toContain("35%");
  expect(host.textContent).toContain("Review schedule");
  expect(host.textContent).toContain("IP-001");
  expect(host.textContent).toContain("ipCommerce.paid");
  expect(h.post).not.toHaveBeenCalled();
  expect(h.put).not.toHaveBeenCalled();
});
it("clears private totals during refresh, shows backend errors, and allows retry", async () => {
  await mount();
  h.get.mockRejectedValueOnce(new Error("Access removed"));
  await refresh();
  expect(host.textContent).toContain("Access removed");
  expect(host.textContent).not.toContain("IP-001");
  expect(host.textContent).not.toContain("9,007,199");
  await refresh();
  expect(host.textContent).toContain("IP-001");
});
it("supports no orders and future status text without substituting a success state", async () => {
  const value = fixture();
  value.recentOrders = [];
  h.get.mockResolvedValue(value);
  await mount();
  expect(host.textContent).toContain("ipCommerce.noOrders");
  value.recentOrders = fixture().recentOrders;
  value.recentOrders[0].status = "manual_review";
  await refresh();
  expect(host.textContent).toContain("manual_review");
});
it("removes private commerce on backgrounding and changed authentication", async () => {
  await mount();
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  h.active = true;
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});
it("ignores an old in-flight result after the screen unmounts", async () => {
  let finish!: (value: unknown) => void;
  h.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await mount();
  h.active = false;
  await mount();
  await act(async () => finish(fixture()));
  expect(host.textContent).toBe("");
});
