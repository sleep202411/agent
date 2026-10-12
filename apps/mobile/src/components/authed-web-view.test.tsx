// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthedWebView } from "./authed-web-view";
import CrewApplicationsScreen from "@/app/crew-applications";
const state = vi.hoisted(() => ({
  token: { tokenName: "satoken", tokenValue: "fixture-token" } as {
    tokenName: string;
    tokenValue: string;
  } | null,
  props: null as any,
}));
vi.mock("@/features/services/crew-applications", () => ({
  CrewApplications: ({ onWeb }: { onWeb: () => void }) => (
    <button onClick={onWeb}>advanced-web</button>
  ),
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button>,
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
  useAuth: () => ({
    status: state.token ? "authenticated" : "anonymous",
    user: state.token ? { id: "user" } : undefined,
    generation: state.token ? 1 : 0,
    session: state.token ? { token: state.token } : null,
  }),
  useAuthGate: () => ({ openLogin: vi.fn(), requireAuth: vi.fn() }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/config", () => ({ webBaseUrl: "https://app.example" }));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useLocale: () => "en-US", useTranslations: () => (s: string) => s }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

it("opens advanced Crew applications from the native workflow in the authenticated shell", async () => {
  await act(async () => root.render(<CrewApplicationsScreen />));
  await act(async () => host.querySelector("button")!.click());
  expect(state.props.source).toEqual({
    uri: "https://app.example/en-US/crews/applications",
    headers: { Cookie: "satoken=fixture-token" },
  });
  expect(state.props.applicationNameForUserAgent).toBe("FizzDragonApp");
});

it("gates a direct application link and resumes that workflow after login", async () => {
  state.token = null;
  await act(async () => root.render(<CrewApplicationsScreen />));
  expect(state.props).toBeNull();
  expect(host.textContent).toContain("crewTerms.signIn");
  state.token = { tokenName: "satoken", tokenValue: "fresh-session" };
  await act(async () => root.render(<CrewApplicationsScreen />));
  expect(host.textContent).not.toContain("crewTerms.signIn");
  await act(async () => host.querySelector("button")!.click());
  expect(state.props.source).toEqual({
    uri: "https://app.example/en-US/crews/applications",
    headers: { Cookie: "satoken=fresh-session" },
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

it.each([
  "https://app.example/en-US/ip/login-guide",
  "https://app.example/en-US/referral?next=/login",
  "https://app.example/en-US/referral#/login",
  "https://payments.example/login",
  "https://app.example.external.example/en-US/login",
  "https://app.example:444/en-US/login",
])("does not replace valid navigation with native sign-in: %s", async (url) => {
  await mount();
  await act(async () => state.props.onNavigationStateChange({ url, canGoBack: false }));
  expect(host.textContent).not.toContain("authedWeb.sessionNeeded");
});

it.each([
  "https://app.example/login",
  "https://app.example/en-US/login?next=%2Freferral",
  "https://app.example/zh-CN/login",
  "https://app.example/zh-HK/login/",
])("requests native sign-in for the trusted login route: %s", async (url) => {
  await mount();
  await act(async () => state.props.onNavigationStateChange({ url, canGoBack: false }));
  expect(host.textContent).toContain("authedWeb.sessionNeeded");
});

it("clears the previous session's sign-in failure after a fresh token arrives", async () => {
  await mount();
  await act(async () =>
    state.props.onNavigationStateChange({ url: "https://app.example/login", canGoBack: false })
  );
  expect(host.textContent).toContain("authedWeb.sessionNeeded");
  state.token = { tokenName: "satoken", tokenValue: "new-session-token" };
  await mount();
  expect(host.textContent).not.toContain("authedWeb.sessionNeeded");
  expect(state.props.source.headers.Cookie).toBe("satoken=new-session-token");
});
