import { useImperativeHandle, useMemo, useRef } from "react";
import { Linking } from "react-native";
import { safeMapAttributionUrl } from "./frame-types";
import { WebView } from "react-native-webview";
import { documentUrl, injection, type MapFrameProps } from "./frame-types";
export function MapFrame({ ref, url, channel, title, onMessage, onError }: MapFrameProps) {
  const frame = useRef<WebView>(null);
  const uri = useMemo(() => documentUrl(url, channel), [url, channel]);
  useImperativeHandle(
    ref,
    () => ({
      send(raw) {
        frame.current?.injectJavaScript(injection(raw));
      },
    }),
    []
  );
  return (
    <WebView
      ref={frame}
      accessibilityLabel={title}
      source={{ uri }}
      style={{ flex: 1, backgroundColor: "#0B0D12" }}
      originWhitelist={["*"]}
      javaScriptEnabled
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      incognito
      allowFileAccess={false}
      mixedContentMode="never"
      geolocationEnabled={false}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === uri) return true;
        if (request.navigationType === "click" && safeMapAttributionUrl(request.url))
          void Linking.openURL(request.url).catch(() => {});
        return false;
      }}
      onOpenWindow={(event) => {
        if (safeMapAttributionUrl(event.nativeEvent.targetUrl))
          void Linking.openURL(event.nativeEvent.targetUrl).catch(() => {});
      }}
      onMessage={(event) => {
        if (event.nativeEvent.url === uri) onMessage(event.nativeEvent.data);
      }}
      onError={onError}
      onHttpError={onError}
      onContentProcessDidTerminate={onError}
      onRenderProcessGone={onError}
    />
  );
}
