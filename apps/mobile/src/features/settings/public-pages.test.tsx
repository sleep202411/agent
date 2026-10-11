import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SettingsScreen from "@/app/settings";
const h = vi.hoisted(() => ({
  region: "global",
  push: vi.fn(),
  open: vi.fn(),
  legal: vi.fn(),
  auth: vi.fn(),
  locale: "en-US",
  base: "https://fizzdragon.com",
}));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: h.open }));
vi.mock("@/lib/legal", () => ({ openLegal: h.legal }));
vi.mock("@/config", () => ({
  appEnv: {
    get appRegion() {
      return h.region;
    },
  },
  get webBaseUrl() {
    return h.base;
  },
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: h.push }),
}));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));
vi.mock("@/auth", () => ({ useAuthGate: () => ({ requireAuth: h.auth }) }));
vi.mock("@/lib/update-check", () => ({ checkForUpdate: vi.fn() }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useLocale: () => h.locale,
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  StyleSheet: { create: (value: unknown) => value },
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  h.region = "global";
  h.locale = "en-US";
  h.base = "https://fizzdragon.com";
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
const mount = () => act(async () => root.render(<SettingsScreen />));
const click = (label: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });
it.each(["en-US", "zh-CN", "zh-HK"])(
  "opens the regional FAQ in %s without requiring login",
  async (locale) => {
    h.locale = locale;
    h.base = "https://fizzdragon.fizzspace.cn";
    await mount();
    await click("settings.faq");
    expect(h.open).toHaveBeenCalledWith(`https://fizzdragon.fizzspace.cn/${locale}/faq`);
    expect(h.auth).not.toHaveBeenCalled();
  }
);
it("keeps refund, privacy and terms on the official legal routing path", async () => {
  h.locale = "zh-HK";
  await mount();
  for (const [label, path] of [
    ["refund", "/refund-policy"],
    ["privacy", "/privacy-policy"],
    ["terms", "/terms-of-service"],
  ]) {
    await click(`settings.${label}`);
    expect(h.legal).toHaveBeenLastCalledWith(path, "zh-HK");
  }
  expect(h.auth).not.toHaveBeenCalled();
  await click("settings.accountSecurity");
  expect(h.auth).toHaveBeenCalledTimes(1);
});
it("prevents duplicate browser launches and exposes failures for retry", async () => {
  let reject!: (e: Error) => void;
  h.open.mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      })
  );
  await mount();
  await click("settings.faq");
  await click("settings.faq");
  expect(h.open).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("Browser unavailable")));
  expect(host.textContent).toContain("Browser unavailable");
  await click("settings.faq");
  expect(h.open).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain("Browser unavailable");
});

it("offers KYC only in CN and defers navigation until authentication", async () => {
  await mount();
  expect(host.textContent).not.toContain("kyc.title");
  h.region = "cn";
  await mount();
  await click("kyc.title");
  expect(h.push).not.toHaveBeenCalled();
  h.auth.mock.calls[0][0].onAuthenticated();
  expect(h.push).toHaveBeenCalledWith("/kyc");
});

it.each(["https://fizzdragon.com", "https://fizzdragon.fizzspace.cn"])(
  "opens the maintained community QR on %s without authentication",
  async (base) => {
    h.base = base;
    await mount();
    await click("settings.community");
    expect(h.open).toHaveBeenCalledWith(`${base}/discord-qr.png`);
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.legal).not.toHaveBeenCalled();
  }
);
