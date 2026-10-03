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
  focused: true,
  os: "ios",
  back: null as (() => boolean) | null,
  goBack: vi.fn(),
  removeBack: vi.fn(),
}));
vi.mock("@/features/services/crew-applications", () => ({
  CrewApplications: ({ onWeb }: { onWeb: () => void }) => (
    <button onClick={onWeb}>advanced-web</button>
  ),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useIsFocused: () => state.focused,
  useLocalSearchParams: () => ({}),
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button>,
  Platform: {
    get OS() {
      return state.os;
    },
  },
  BackHandler: {
    addEventListener: (_event: string, handler: () => boolean) => {
      state.back = handler;
      return {
        remove: () => {
          state.removeBack();
          if (state.back === handler) state.back = null;
        },
      };
    },
  },
  StyleSheet: { create: (s: any) => s, absoluteFill: {} },
}));
vi.mock("react-native-webview", () => ({
  WebView: (props: any) => {
    React.useImperativeHandle(props.ref, () => ({ goBack: state.goBack, stopLoading: vi.fn() }));
    state.props = props;
    return null;
  },
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: state.token ? "authenticated" : "anonymous",
    generation: state.token ? 1 : 0,
    user: state.token ? { id: "user" } : undefined,
    session: state.token ? { token: state.token } : null,
  }),
  useAuthGate: () => ({ openLogin: vi.fn() }),
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
  state.focused = true;
  state.os = "ios";
  state.back = null;
  state.goBack.mockClear();
  state.removeBack.mockClear();
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

it("opens the existing Crew application workflow inside the authenticated native shell", async () => {
  await act(async () => root.render(<CrewApplicationsScreen />));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(state.props.source).toEqual({
    uri: "https://app.example/en-US/messages?tab=recruitment",
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
  expect(host.textContent).toContain("advanced-web");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(state.props.source).toEqual({
    uri: "https://app.example/en-US/messages?tab=recruitment",
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

it("shows document HTTP failures and lets the user retry with authentication", async () => {
  await mount();
  const failedAttempt = state.props;
  await act(async () =>
    failedAttempt.onHttpError({
      nativeEvent: {
        url: "https://app.example/en-US/referral",
        statusCode: 503,
        description: "Service unavailable",
      },
    })
  );
  expect(host.textContent).toContain("HTTP 503: Service unavailable");
  await act(async () => failedAttempt.onLoadEnd());
  expect(host.textContent).toContain("authedWeb.retry");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent).not.toContain("authedWeb.loadFailed");
  expect(state.props.source.headers.Cookie).toBe("satoken=fixture-token");
  await act(async () => failedAttempt.onError({ nativeEvent: { description: "Stale failure" } }));
  expect(host.textContent).not.toContain("Stale failure");
});

it("ignores failed subresources but handles a newly navigated document", async () => {
  await mount();
  await act(async () =>
    state.props.onHttpError({
      nativeEvent: {
        url: "https://app.example/icon.png",
        statusCode: 404,
        description: "Not found",
      },
    })
  );
  expect(host.textContent).not.toContain("authedWeb.loadFailed");
  await act(async () =>
    state.props.onLoadStart({
      nativeEvent: {
        url: "https://app.example/en-US/profile/earnings",
      },
    })
  );
  await act(async () =>
    state.props.onHttpError({
      nativeEvent: {
        url: "https://app.example/en-US/profile/earnings",
        statusCode: 500,
        description: "Income temporarily unavailable",
      },
    })
  );
  expect(host.textContent).toContain("HTTP 500: Income temporarily unavailable");
});

it("preserves the native transport error detail", async () => {
  await mount();
  await act(async () => state.props.onError({ nativeEvent: { description: "Connection lost" } }));
  expect(host.textContent).toContain("Connection lost");
  expect(host.textContent).toContain("authedWeb.retry");
});

it("handles Android back only while its route is focused and history is available", async () => {
  state.os = "android";
  await mount();
  expect(state.back?.()).toBe(false);
  await act(async () =>
    state.props.onNavigationStateChange({
      url: "https://app.example/en-US/referral/history",
      canGoBack: true,
    })
  );
  expect(state.back?.()).toBe(true);
  expect(state.goBack).toHaveBeenCalledTimes(1);
  state.focused = false;
  await mount();
  expect(state.removeBack).toHaveBeenCalledTimes(1);
  expect(state.back).toBeNull();
  state.focused = true;
  await mount();
  expect(state.back?.()).toBe(true);
  expect(state.goBack).toHaveBeenCalledTimes(2);
  await act(async () =>
    state.props.onNavigationStateChange({
      url: "https://app.example/en-US/referral",
      canGoBack: false,
    })
  );
  expect(state.back?.()).toBe(false);
});

it("ignores navigation events from a failed WebView after retry", async () => {
  state.os = "android";
  await mount();
  const retired = state.props;
  await act(async () => retired.onError({ nativeEvent: { description: "Offline" } }));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  const current = state.props;
  await act(async () =>
    retired.onNavigationStateChange({
      url: "https://app.example/login",
      canGoBack: true,
    })
  );
  expect(host.textContent).not.toContain("authedWeb.sessionNeeded");
  expect(state.back?.()).toBe(false);
  await act(async () =>
    current.onNavigationStateChange({
      url: "https://app.example/en-US/referral/history",
      canGoBack: true,
    })
  );
  expect(state.back?.()).toBe(true);
  await act(async () =>
    current.onNavigationStateChange({
      url: "https://app.example/login",
      canGoBack: false,
    })
  );
  expect(host.textContent).toContain("authedWeb.sessionNeeded");
});
