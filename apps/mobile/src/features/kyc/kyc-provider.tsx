import { useRef } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { kycMetadataHtml, parseKycMetadata, kycNavigation } from "./kyc-provider-policy";

/** The SDK bridge collects device metadata only; it never receives app credentials. */
export function KycMetadata({
  onReady,
  onError,
}: {
  onReady: (value: string) => void;
  onError: () => void;
}) {
  const settled = useRef(false);
  const fail = () => {
    if (!settled.current) {
      settled.current = true;
      onError();
    }
  };
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ height: 1, width: 1, opacity: 0, overflow: "hidden" }}
    >
      <WebView
        source={{ html: kycMetadataHtml }}
        incognito
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        originWhitelist={["*"]}
        javaScriptEnabled
        allowFileAccess={false}
        mixedContentMode="never"
        onShouldStartLoadWithRequest={({ url }) => url === "about:blank"}
        onError={fail}
        onHttpError={fail}
        onContentProcessDidTerminate={fail}
        onRenderProcessGone={fail}
        onMessage={({ nativeEvent }) => {
          if (settled.current) return;
          try {
            const value = parseKycMetadata(nativeEvent.data);
            settled.current = true;
            onReady(value);
          } catch {
            fail();
          }
        }}
      />
    </View>
  );
}

/** Isolated provider browser: no app token, cookies or JavaScript message bridge. */
export function KycProvider({
  uri,
  returnUrl,
  title,
  onReturn,
  onError,
}: {
  uri: string;
  returnUrl: string;
  title: string;
  onReturn: (url: string) => void;
  onError: () => void;
}) {
  const returned = useRef(false);
  const navigate = (url: string) => {
    const kind = kycNavigation(url, uri, returnUrl);
    if (kind === "return") {
      if (!returned.current) {
        returned.current = true;
        onReturn(url);
      }
      return false;
    }
    if (kind === "blocked") {
      onError();
      return false;
    }
    return !returned.current;
  };
  return (
    <WebView
      accessibilityLabel={title}
      source={{ uri }}
      style={{ height: 560, flex: 0 }}
      incognito
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      originWhitelist={["*"]}
      javaScriptEnabled
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      javaScriptCanOpenWindowsAutomatically={false}
      mediaCapturePermissionGrantType="prompt"
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction
      onShouldStartLoadWithRequest={({ url }) => navigate(url)}
      onNavigationStateChange={({ url }) => {
        if (kycNavigation(url, uri, returnUrl) === "return") navigate(url);
      }}
      onOpenWindow={onError}
      onError={onError}
      onHttpError={onError}
      onContentProcessDidTerminate={onError}
      onRenderProcessGone={onError}
    />
  );
}
