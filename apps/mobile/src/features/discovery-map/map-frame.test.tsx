import { act, createRef, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MapFrame } from "./map-frame";
import type { MapFrameHandle } from "./frame-types";
import type { WebViewProps } from "react-native-webview";
const h = vi.hoisted(() => ({
  props: null as WebViewProps | null,
  inject: vi.fn(),
  open: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("react-native", () => ({ Linking: { openURL: h.open } }));
vi.mock("react-native-webview", () => ({
  WebView: ({ ref, ...props }: WebViewProps & { ref: never }) => {
    h.props = props;
    useImperativeHandle(ref, () => ({ injectJavaScript: h.inject }), []);
    return <div />;
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("isolates cookies, rejects foreign document messages and intercepts navigation", async () => {
  const host = document.createElement("div"),
    root = createRoot(host),
    ref = createRef<MapFrameHandle>();
  const receive = vi.fn(),
    error = vi.fn();
  try {
    await act(async () =>
      root.render(
        <MapFrame
          ref={ref}
          url="https://maps.example.test/map.html"
          channel="native-test-channel-12345"
          title="Map"
          onMessage={receive}
          onError={error}
        />
      )
    );
    const props = h.props!;
    expect(props).toMatchObject({
      incognito: true,
      sharedCookiesEnabled: false,
      thirdPartyCookiesEnabled: false,
      allowFileAccess: false,
      geolocationEnabled: false,
      mixedContentMode: "never",
      originWhitelist: ["*"],
    });
    const uri = (props.source as { uri: string }).uri;
    expect(props.onShouldStartLoadWithRequest!({ url: uri } as never)).toBe(true);
    expect(
      props.onShouldStartLoadWithRequest!({
        url: "https://evil.test",
        navigationType: "click",
      } as never)
    ).toBe(false);
    expect(h.open).not.toHaveBeenCalled();
    expect(
      props.onShouldStartLoadWithRequest!({
        url: "https://maps.google.com/maps",
        navigationType: "click",
      } as never)
    ).toBe(false);
    expect(h.open).toHaveBeenCalledWith("https://maps.google.com/maps");
    props.onMessage!({ nativeEvent: { url: "https://evil.test", data: "bad" } } as never);
    expect(receive).not.toHaveBeenCalled();
    props.onMessage!({ nativeEvent: { url: uri, data: "message" } } as never);
    expect(receive).toHaveBeenCalledWith("message");
    ref.current!.send('";alert(1);//');
    expect(h.inject).toHaveBeenCalled();
    props.onRenderProcessGone!({} as never);
    expect(error).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
});
