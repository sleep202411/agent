import React, { act, createRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// eslint-disable-next-line import/no-duplicates -- Exercise both platform implementations; ESLint resolves both to Web.
import { WorldRuntimeFrame as NativeFrame } from "./world-runtime-frame";
// eslint-disable-next-line import/no-duplicates -- Explicit Web implementation alongside the native test subject.
import { WorldRuntimeFrame as BrowserFrame } from "./world-runtime-frame.web";
import type { WorldRuntimeFrameHandle } from "./world-runtime-frame-types";
const h = vi.hoisted(() => ({ inject: vi.fn(), native: null as any }));
vi.mock("react-native-webview", () => ({
  WebView: function WebView(props: any) {
    h.native = props;
    useImperativeHandle(props.ref, () => ({ injectJavaScript: h.inject }));
    return null;
  },
}));
let root: Root, host: HTMLDivElement;
const message = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  requestId: "1",
  type: "pause" as const,
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("keeps the native document stable and sends only validated injected commands", async () => {
  const ref = createRef<WorldRuntimeFrameHandle>();
  const props = { html: "<video></video>", title: "World", onMessage: vi.fn(), onError: vi.fn() };
  await act(async () => root.render(<NativeFrame ref={ref} {...props} />));
  const source = h.native.source;
  await act(async () => root.render(<NativeFrame ref={ref} {...props} title="Updated label" />));
  expect(h.native.source).toBe(source);
  ref.current!.send(message);
  expect(h.inject).toHaveBeenCalledOnce();
  expect(h.inject.mock.calls[0][0]).toContain("__fizzWorldReceive");
  expect(() => ref.current!.send({ ...message, sessionId: "invalid" })).toThrow();
  expect(h.inject).toHaveBeenCalledOnce();
  h.native.onMessage({ nativeEvent: { data: "provider message" } });
  expect(props.onMessage).toHaveBeenCalledWith("provider message");
});

it("blocks native navigation, file access, shared cookies and media capture", async () => {
  const onError = vi.fn();
  await act(async () =>
    root.render(
      <NativeFrame html="<video></video>" title="World" onMessage={vi.fn()} onError={onError} />
    )
  );
  expect(h.native.onShouldStartLoadWithRequest({ url: "about:blank" })).toBe(true);
  for (const url of [
    "https://fixture.invalid",
    "file:///secret",
    "javascript:alert(1)",
    "intent://external",
  ]) {
    expect(h.native.onShouldStartLoadWithRequest({ url })).toBe(false);
  }
  expect(h.native).toMatchObject({
    allowFileAccess: false,
    allowFileAccessFromFileURLs: false,
    allowUniversalAccessFromFileURLs: false,
    sharedCookiesEnabled: false,
    thirdPartyCookiesEnabled: false,
    mediaCapturePermissionGrantType: "deny",
    allowsInlineMediaPlayback: true,
    mixedContentMode: "never",
  });
  h.native.onError({ nativeEvent: { description: "WebView unavailable" } });
  expect(onError).toHaveBeenLastCalledWith(
    expect.objectContaining({ message: "WebView unavailable" })
  );
  h.native.onRenderProcessGone();
  expect(onError).toHaveBeenLastCalledWith(
    expect.objectContaining({ message: "World playback process terminated." })
  );
});

it("accepts browser messages only from its mounted frame and removes the listener on exit", async () => {
  const ref = createRef<WorldRuntimeFrameHandle>();
  const onMessage = vi.fn();
  await act(async () =>
    root.render(
      <BrowserFrame
        ref={ref}
        html="<video></video>"
        title="World"
        onMessage={onMessage}
        onError={vi.fn()}
      />
    )
  );
  const frame = host.querySelector("iframe")!;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.getAttribute("allow")).toBe("autoplay");
  const source = frame.contentWindow!;
  const post = vi.spyOn(source, "postMessage");
  ref.current!.send(message);
  expect(post).toHaveBeenCalledWith(JSON.stringify(message), "*");
  window.dispatchEvent(new MessageEvent("message", { source: window, data: "foreign" }));
  window.dispatchEvent(new MessageEvent("message", { source, data: "own" }));
  expect(onMessage).toHaveBeenCalledExactlyOnceWith("own");
  await act(async () => root.render(null));
  window.dispatchEvent(new MessageEvent("message", { source, data: "late" }));
  expect(onMessage).toHaveBeenCalledOnce();
  expect(ref.current).toBeNull();
});
