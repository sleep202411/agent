import { WebView } from "react-native-webview";
import { readPanoramaEvent, type PanoramaFrameProps } from "../lib/story-panorama-document";
export function StoryPanoramaFrame({ html, title, sessionId, onEvent }: PanoramaFrameProps) {
  return (
    <WebView
      source={{ html }}
      accessibilityLabel={title}
      style={{ flex: 1, backgroundColor: "#090909" }}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      allowFileAccess={false}
      mixedContentMode="never"
      incognito
      onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
      onMessage={(event) => {
        const value = readPanoramaEvent(event.nativeEvent.data, sessionId);
        if (value) onEvent(value.type, value.detail);
      }}
      onError={() => onEvent("error")}
      onContentProcessDidTerminate={() => onEvent("error")}
      onRenderProcessGone={() => onEvent("error")}
    />
  );
}
