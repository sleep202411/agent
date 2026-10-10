import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { WebView } from "react-native-webview";
import { worldRuntimeInjection } from "./world-runtime-document";
import type { WorldRuntimeFrameHandle, WorldRuntimeFrameProps } from "./world-runtime-frame-types";

/** Bundled provider surface. App authentication stays in the native API layer. */
export const WorldRuntimeFrame = forwardRef<WorldRuntimeFrameHandle, WorldRuntimeFrameProps>(
  function WorldRuntimeFrame({ html, title, onMessage, onError }, ref) {
    const frame = useRef<WebView>(null);
    const source = useMemo(() => ({ html }), [html]);
    useImperativeHandle(
      ref,
      () => ({
        send(message) {
          if (!frame.current) throw new Error("World playback surface is not mounted.");
          frame.current.injectJavaScript(worldRuntimeInjection(message));
        },
      }),
      []
    );
    return (
      <WebView
        ref={frame}
        source={source}
        accessibilityLabel={title}
        style={{ flex: 1, backgroundColor: "#000000" }}
        originWhitelist={["*"]}
        javaScriptEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo={false}
        allowsPictureInPictureMediaPlayback={false}
        mediaCapturePermissionGrantType="deny"
        domStorageEnabled={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        javaScriptCanOpenWindowsAutomatically={false}
        onOpenWindow={() => undefined}
        onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
        onMessage={(event) => onMessage(event.nativeEvent.data)}
        onError={(event) => onError(new Error(event.nativeEvent.description))}
        onContentProcessDidTerminate={() =>
          onError(new Error("World playback process terminated."))
        }
        onRenderProcessGone={() => onError(new Error("World playback process terminated."))}
        scrollEnabled={false}
        bounces={false}
      />
    );
  }
);
