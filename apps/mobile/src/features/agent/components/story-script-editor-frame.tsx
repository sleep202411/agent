import { forwardRef, useImperativeHandle, useRef } from "react";
import { WebView } from "react-native-webview";
import { scriptHostInjection } from "../lib/story-script-editor-bridge";
import type { ScriptHostMessage } from "../../../../script-editor/protocol";
export type ScriptFrameHandle = { send(message: ScriptHostMessage): void };
export type ScriptFrameProps = {
  html: string;
  title: string;
  onMessage(raw: unknown): void;
  onError(): void;
};
export const ScriptEditorFrame = forwardRef<ScriptFrameHandle, ScriptFrameProps>(
  function ScriptEditorFrame({ html, title, onMessage, onError }, ref) {
    const frame = useRef<WebView>(null);
    useImperativeHandle(
      ref,
      () => ({ send: (message) => frame.current?.injectJavaScript(scriptHostInjection(message)) }),
      []
    );
    return (
      <WebView
        ref={frame}
        accessibilityLabel={title}
        source={{ html }}
        style={{ flex: 1, backgroundColor: "#0b0d12" }}
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
