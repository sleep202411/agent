import { WebView } from "react-native-webview";

export function ProductionDocumentView({
  html,
  title,
  onError,
}: {
  html: string;
  title: string;
  onError: () => void;
}) {
  return (
    <WebView
      accessibilityLabel={title}
      source={{ html }}
      style={{ flex: 1, backgroundColor: "#0B0D12" }}
      // Intercept every navigation here; unmatched origins would otherwise open externally.
      originWhitelist={["*"]}
      javaScriptEnabled={false}
      domStorageEnabled={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      allowFileAccess={false}
      mixedContentMode="never"
      onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
      onError={onError}
      onHttpError={onError}
      onContentProcessDidTerminate={onError}
      onRenderProcessGone={onError}
    />
  );
}
