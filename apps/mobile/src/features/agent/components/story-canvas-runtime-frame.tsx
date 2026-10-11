import { forwardRef, useImperativeHandle, useRef } from "react";
import { WebView } from "react-native-webview";
import { canvasHostInjection } from "../lib/story-canvas-bridge";
import type { CanvasHostMessage } from "../../../../canvas-editor/protocol";
export type CanvasFrameHandle = { send(message: CanvasHostMessage): void };
export type CanvasFrameProps = {
  html: string;
  title: string;
  onMessage(raw: unknown): void;
  onError(): void;
};
export const CanvasRuntimeFrame = forwardRef<CanvasFrameHandle, CanvasFrameProps>(
  function CanvasRuntimeFrame({ html, title, onMessage, onError }, ref) {
    const frame = useRef<WebView>(null);
    useImperativeHandle(
      ref,
      () => ({ send: (message) => frame.current?.injectJavaScript(canvasHostInjection(message)) }),
      []
    );
    return (
      <WebView
        ref={frame}
        accessibilityLabel={title}
        source={{ html }}
        style={{ width: 1, height: 1, opacity: 0 }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
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
);
