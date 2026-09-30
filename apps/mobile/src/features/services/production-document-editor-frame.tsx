import { WebView } from "react-native-webview";
export function DocumentEditorFrame({
  html,
  onMessage,
  onError,
  title,
}: {
  html: string;
  title: string;
  onMessage: (raw: unknown) => void;
  onError: () => void;
}) {
  return (
    <WebView
      accessibilityLabel={title}
      source={{ html }}
      style={{ flex: 1, backgroundColor: "#0B0D12" }}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      allowFileAccess={false}
      mixedContentMode="never"
      onShouldStartLoadWithRequest={(r) => r.url === "about:blank"}
      onMessage={(e) => onMessage(e.nativeEvent.data)}
      onError={onError}
      onContentProcessDidTerminate={onError}
      onRenderProcessGone={onError}
    />
  );
}
