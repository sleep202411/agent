import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

const ALIYUN_SDK_URL = "https://o.alicdn.com/yd-cloudauth/cloudauth-cdn/jsvm_all.js";

type MetaMessage =
  | {
      metaInfo: string;
      type: "meta";
    }
  | {
      message?: string;
      type: "error";
    };

export function AliyunMetaWebView({
  onError,
  onReady,
  reloadKey,
}: {
  onError: (message?: string) => void;
  onReady: (metaInfo: string) => void;
  reloadKey: number;
}) {
  const html = useMemo(() => createMetaHtml(), []);

  function handleMessage(event: WebViewMessageEvent) {
    let payload: MetaMessage;
    try {
      payload = JSON.parse(event.nativeEvent.data) as MetaMessage;
    } catch {
      onError();
      return;
    }

    if (payload.type === "meta" && payload.metaInfo.trim()) {
      onReady(payload.metaInfo);
      return;
    }

    onError(payload.type === "error" ? payload.message : undefined);
  }

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.host}
    >
      <WebView
        key={reloadKey}
        domStorageEnabled
        javaScriptEnabled
        onMessage={handleMessage}
        originWhitelist={["*"]}
        source={{ html }}
        style={styles.webview}
      />
    </View>
  );
}

function createMetaHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
  </head>
  <body>
    <script>
      (function () {
        var completed = false;
        function post(payload) {
          if (completed) return;
          completed = true;
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
        function collect() {
          try {
            if (typeof window.getMetaInfo !== "function") {
              throw new Error("getMetaInfo is not available");
            }
            var metaInfo = window.getMetaInfo();
            post({
              type: "meta",
              metaInfo: typeof metaInfo === "string" ? metaInfo : JSON.stringify(metaInfo)
            });
          } catch (error) {
            post({ type: "error", message: error && error.message ? error.message : String(error) });
          }
        }
        var script = document.createElement("script");
        script.async = true;
        script.src = "${ALIYUN_SDK_URL}";
        script.onload = function () { setTimeout(collect, 0); };
        script.onerror = function () { post({ type: "error", message: "Aliyun SDK load failed" }); };
        document.head.appendChild(script);
        setTimeout(function () {
          post({ type: "error", message: "Aliyun SDK load timed out" });
        }, 15000);
      })();
    </script>
  </body>
</html>`;
}

const styles = StyleSheet.create({
  host: {
    height: 1,
    left: -20,
    opacity: 0.01,
    overflow: "hidden",
    position: "absolute",
    top: -20,
    width: 1,
  },
  webview: {
    height: 1,
    width: 1,
  },
});
