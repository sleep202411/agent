/**
 * Reusable authenticated WebView over apps/web pages (first use: 邀请奖励).
 *
 * The auth bridge is ~one cookie — Nest and the web proxy both accept
 * `satoken=<tokenValue>` — but it must be delivered twice:
 *  - `source.headers.Cookie` carries it on the INITIAL document request, so
 *    apps/web's server-side login gate (proxy.ts) passes. An injected script
 *    runs too late for that first request.
 *  - `injectedJavaScriptBeforeContentLoaded` writes `document.cookie`, so the
 *    page's own `credentials:"include"` fetches to /aurora/* are authed and
 *    later in-webview navigations survive (custom headers only apply to the
 *    first request).
 * The WebView remounts (key = token) when the session changes, so re-login
 * always produces a fresh cookie.
 *
 * If the web side still bounces to /login (expired/revoked token), we stop
 * and show a native sign-in prompt instead of rendering the web login page.
 */
import { Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";

import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { webBaseUrl } from "@/config";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";

type AuthedWebViewProps = {
  /** apps/web path WITHOUT the locale prefix, e.g. "/referral". */
  path: string;
  /** Native header title. */
  title: string;
  /**
   * When true (default), the WebView UA marks `FizzDragonApp` so apps/web
   * drops its nav/footer. Set false for a full “网页版” page (credits chip).
   */
  nativeShell?: boolean;
};

/** Cookie values must not smuggle attribute separators into the header. */
function sanitizeCookieValue(value: string): string {
  return value.replace(/[;,\s]/g, "");
}

/** Only our login document signals an expired app session. Provider logins and
 * URLs mentioning login in a query, fragment, or content slug are normal navigation.
 */
function isAppLoginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === new URL(webBaseUrl).origin &&
      /^\/(?:en-US\/|zh-CN\/|zh-HK\/)?login\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function AuthedWebView(props: AuthedWebViewProps) {
  const auth = useAuth();
  // Remount the whole session, not just the native WebView: an expired-session
  // prompt otherwise hides that WebView and survives a successful new login.
  return (
    <AuthedWebViewSession
      key={JSON.stringify([auth.generation, auth.session?.token, props.path])}
      {...props}
    />
  );
}

function AuthedWebViewSession({ path, title, nativeShell = true }: AuthedWebViewProps) {
  const auth = useAuth();
  const authGate = useAuthGate();
  const locale = useLocale();
  const theme = useTheme();
  const t = useTranslations();
  const webViewRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<"error" | "auth" | null>(null);
  /** Bumping remounts the WebView — the reliable "reload with cookie" reset. */
  const [attempt, setAttempt] = useState(0);

  const token = auth.session?.token;
  const uri = `${webBaseUrl}/${locale}${path}`;

  const cookie = useMemo(() => {
    if (!token) return null;
    return `${sanitizeCookieValue(token.tokenName)}=${sanitizeCookieValue(token.tokenValue)}`;
  }, [token]);

  // Sets the cookie in the WebView's cookie store before the page runs, so
  // the app's client-side /aurora fetches are authenticated.
  const bootstrapScript = useMemo(() => {
    if (!cookie) return undefined;
    // Native user scripts can run again after navigation. Never copy the app
    // session into a different site's cookie jar (including payment redirects).
    const trustedOrigin = new URL(webBaseUrl).origin;
    return `if (window.location.origin === ${JSON.stringify(trustedOrigin)}) { document.cookie = ${JSON.stringify(`${cookie}; path=/; secure; samesite=lax`)}; } true;`;
  }, [cookie]);

  // Android hardware back walks the in-webview history before leaving.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBackRef.current && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, []);

  const onNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    canGoBackRef.current = navState.canGoBack;
    // The web side only redirects to /login when the token was rejected —
    // surface the NATIVE sign-in instead of rendering the web login page.
    if (isAppLoginUrl(navState.url)) {
      webViewRef.current?.stopLoading();
      setFailure("auth");
    }
  }, []);

  const retry = useCallback(() => {
    setFailure(null);
    setLoaded(false);
    setAttempt((current) => current + 1);
  }, []);

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        headerTitle: title,
        headerBackButtonDisplayMode: "minimal",
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerShadowVisible: false,
      }}
    />
  );

  if (!cookie || failure === "auth") {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: theme.background }]}>
        {header}
        <ThemedText type="small" themeColor="textSecondary" style={styles.centerBody}>
          {t("authedWeb.sessionNeeded")}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setFailure(null);
            authGate.openLogin();
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.brand },
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold" style={styles.primaryButtonText}>
            {t("login.signIn")}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {header}
      <WebView
        key={`${cookie}-${attempt}`}
        ref={webViewRef}
        source={{ uri, headers: { Cookie: cookie } }}
        injectedJavaScriptBeforeContentLoaded={bootstrapScript}
        // Default: mark FizzDragonApp so apps/web drops its nav/footer.
        // `nativeShell={false}` keeps full site chrome (e.g. credits recharge).
        applicationNameForUserAgent={nativeShell ? "FizzDragonApp" : undefined}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled={false}
        pullToRefreshEnabled
        onLoadEnd={() => setLoaded(true)}
        onError={() => setFailure("error")}
        onNavigationStateChange={onNavigationStateChange}
        style={{ backgroundColor: theme.background }}
        // The page is dark-only; keep the native side dark too so there is
        // never a white flash between frames.
        containerStyle={{ backgroundColor: theme.background }}
      />
      {!loaded && failure === null ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.centered, { backgroundColor: theme.background }]}
        >
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : null}
      {failure === "error" ? (
        <View
          style={[StyleSheet.absoluteFill, styles.centered, { backgroundColor: theme.background }]}
        >
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerBody}>
            {t("authedWeb.loadFailed")}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={retry}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: theme.brand },
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold" style={styles.primaryButtonText}>
              {t("authedWeb.retry")}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.six,
  },
  centerBody: {
    textAlign: "center",
  },
  primaryButton: {
    borderRadius: 999,
    marginTop: Spacing.four,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
  },
  primaryButtonText: {
    color: "#FFFFFF",
  },
  pressed: {
    opacity: 0.85,
  },
});
