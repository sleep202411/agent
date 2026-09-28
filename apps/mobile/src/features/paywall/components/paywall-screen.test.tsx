import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PaywallScreen } from "./paywall-screen";

const state = vi.hoisted(() => ({
  channel: "apple_iap",
  buy: vi.fn(),
  push: vi.fn(),
  packs: vi.fn(),
  returnPath: "/ip/example",
  alert: vi.fn(),
}));
vi.mock("@tabler/icons-react-native", () => ({
  IconBolt: () => null,
  IconCheck: () => null,
  IconCoins: () => null,
  IconCrown: () => null,
  IconSparkles: () => null,
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: state.push }),
  useLocalSearchParams: () => ({ category: "community_points", returnPath: state.returnPath }),
}));
vi.mock("react-native", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    View: Box,
    ScrollView: Box,
    KeyboardAvoidingView: Box,
    TextInput: () => null,
    ActivityIndicator: () => <span role="progressbar" />,
    Pressable: ({
      children,
      onPress,
      disabled,
    }: {
      children?: ReactNode;
      onPress?: () => void;
      disabled?: boolean;
    }) => (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ),
    Alert: { alert: state.alert },
    Platform: { OS: "ios", select: (value: { ios?: unknown }) => value.ios },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, hairlineWidth: 1 },
  };
});
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/themed-view", () => ({
  ThemedView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/config", () => ({
  appEnv: { appRegion: "global", assets: { userBaseUrl: "" } },
  resolveAssetUrl: (value: string) => value,
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
vi.mock("@/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/navigation", () => ({ toHref: (path: string) => path }));
vi.mock("@/data/ip-api", () => ({ fetchCommunityPointBalance: async () => "0" }));
vi.mock("../lib/compute-wallet", () => ({ fetchComputeWalletBalance: async () => "0" }));
vi.mock("../lib/checkout-channel", () => ({ currentCheckoutChannel: () => state.channel }));
vi.mock("../lib/paywall-store", () => ({
  resolvePaywallCategory: () => "community_points",
  PAYWALL_CATEGORIES: ["community_points"],
}));
vi.mock("../lib/billing-api", () => ({
  listCommunityPointPackages: state.packs,
  getBillingOrder: vi.fn(),
  isOrderDead: () => false,
  isOrderSettled: () => false,
}));
vi.mock("../lib/purchase", () => ({
  purchaseProduct: state.buy,
  restorePurchases: vi.fn(),
  isPurchaseCancelled: () => false,
}));
vi.mock("../lib/wechat", () => ({ communityPackProduct: (value: unknown) => value }));
vi.mock("./wechat-scan-pay", () => ({ WechatScanPay: () => null }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.channel = "apple_iap";
  state.buy.mockImplementation(() => new Promise(() => {}));
  state.packs.mockImplementation(() => new Promise(() => {}));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<PaywallScreen />));
it("connects the buy button to checkout and disables it while a purchase is pending", async () => {
  await render();
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === "paywall.buyNow"
  )!;
  await act(async () => button.click());
  expect(state.buy).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(true);
});
it("keeps the return destination when continuing to web checkout", async () => {
  state.channel = "web";
  await render();
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === "paywall.continueWeb"
  )!;
  await act(async () => button.click());
  expect(state.push).toHaveBeenCalledExactlyOnceWith("/pay/community?returnPath=%2Fip%2Fexample");
  expect(state.buy).not.toHaveBeenCalled();
});
it("renders the WeChat package loading state before prices arrive", async () => {
  state.channel = "wechat";
  await render();
  expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
});
