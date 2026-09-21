// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  token: { tokenName: "satoken", tokenValue: "fixture-token" } as {
    tokenName: string;
    tokenValue: string;
  } | null,
  props: null as any,
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({ children }: any) => <button>{children}</button>,
  Platform: { OS: "ios" },
  BackHandler: {},
  StyleSheet: { create: (s: any) => s, absoluteFill: {} },
}));
vi.mock("react-native-webview", () => ({
  WebView: (props: any) => {
    state.props = props;
    return null;
  },
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ session: state.token ? { token: state.token } : null }),
  useAuthGate: () => ({ openLogin: vi.fn() }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/config", () => ({ webBaseUrl: "https://app.example" }));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useLocale: () => "en-US", useTranslations: () => (s: string) => s }));
import { AuthedWebView } from "./authed-web-view";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  state.token = { tokenName: "satoken", tokenValue: "fixture-token" };
  state.props = null;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function mount() {
  await act(async () => root.render(<AuthedWebView path="/referral" title="Referrals" />));
}
function execute(origin: string) {
  const document = { cookie: "" };
  const result = runInNewContext(state.props.injectedJavaScriptBeforeContentLoaded, {
    document,
    window: { location: { origin } },
  });
  return { cookie: document.cookie, result };
}
it("keeps first-request authentication on the configured app URL", async () => {
  await mount();
  expect(state.props.source).toEqual({
    uri: "https://app.example/en-US/referral",
    headers: { Cookie: "satoken=fixture-token" },
  });
});
it("writes the session cookie on the trusted origin", async () => {
  await mount();
  expect(execute("https://app.example")).toEqual({
    cookie: "satoken=fixture-token; path=/; secure; samesite=lax",
    result: true,
  });
});
it.each([
  "https://external.example",
  "https://app.example.external.example",
  "https://sub.app.example",
  "http://app.example",
  "https://app.example:444",
  "null",
])("does not write the session cookie on %s", async (origin) => {
  await mount();
  expect(execute(origin)).toEqual({ cookie: "", result: true });
});
it("does not mount an authenticated WebView without a session", async () => {
  state.token = null;
  await mount();
  expect(state.props).toBeNull();
});
it("preserves token text without allowing injected JavaScript", async () => {
  state.token = { tokenName: "satoken", tokenValue: 'value"\\quoted' };
  await mount();
  expect(execute("https://app.example").cookie).toBe(
    'satoken=value"\\quoted; path=/; secure; samesite=lax'
  );
});
