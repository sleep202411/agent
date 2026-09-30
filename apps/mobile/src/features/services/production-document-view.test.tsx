/* eslint-disable import/no-duplicates -- Exercise both native and web platform implementations. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductionDocumentView as NativeView } from "./production-document-view";
import { ProductionDocumentView as WebView } from "./production-document-view.web";
const h = vi.hoisted(() => ({
  props: {} as {
    onMessage: (event: { nativeEvent: { data: string } }) => void;
    onShouldStartLoadWithRequest: (request: { url: string }) => boolean;
  },
  link: vi.fn(),
  error: vi.fn(),
}));
vi.mock("react-native-webview", () => ({
  WebView: (props: typeof h.props) => {
    h.props = props;
    return <div />;
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const message = JSON.stringify({ type: "production-link", index: 0 });
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("native bridge only forwards valid indexes and blocks page navigation", async () => {
  await act(async () =>
    root.render(
      <NativeView html="<p>Document</p>" title="Overview" onLink={h.link} onError={h.error} />
    )
  );
  h.props.onMessage({ nativeEvent: { data: message } });
  expect(h.link).toHaveBeenCalledWith(0);
  h.props.onMessage({ nativeEvent: { data: '{"url":"https://attacker.example"}' } });
  expect(h.link).toHaveBeenCalledTimes(1);
  expect(h.props.onShouldStartLoadWithRequest({ url: "about:blank" })).toBe(true);
  expect(h.props.onShouldStartLoadWithRequest({ url: "https://attacker.example" })).toBe(false);
});
it("web bridge ignores messages outside its opaque sandbox and unregisters on exit", async () => {
  await act(async () =>
    root.render(
      <WebView html="<p>Document</p>" title="Overview" onLink={h.link} onError={h.error} />
    )
  );
  const frame = host.querySelector("iframe")!;
  const source = frame.contentWindow!;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  await act(async () =>
    window.dispatchEvent(new MessageEvent("message", { source: window, data: message }))
  );
  expect(h.link).not.toHaveBeenCalled();
  await act(async () =>
    window.dispatchEvent(new MessageEvent("message", { source, data: message }))
  );
  expect(h.link).toHaveBeenCalledWith(0);
  await act(async () => root.render(null));
  window.dispatchEvent(new MessageEvent("message", { source, data: message }));
  expect(h.link).toHaveBeenCalledTimes(1);
});
