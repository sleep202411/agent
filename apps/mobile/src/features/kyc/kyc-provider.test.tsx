import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KycMetadata, KycProvider } from "./kyc-provider";
const h = vi.hoisted(() => ({ props: {} as Record<string, any> }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native-webview", () => ({
  WebView: (props: Record<string, unknown>) => {
    h.props = props;
    return <div />;
  },
}));
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));
it("intercepts a provider return exactly once without sharing the app session", async () => {
  const done = vi.fn(),
    error = vi.fn(),
    uri = "https://verify.aliyun.com/start",
    returnUrl = "https://fizzdragon.fizzspace.cn/zh-CN/kyc";
  await act(async () =>
    root.render(
      <KycProvider uri={uri} returnUrl={returnUrl} title="Verify" onReturn={done} onError={error} />
    )
  );
  expect(h.props.source).toEqual({ uri });
  expect(h.props.sharedCookiesEnabled).toBe(false);
  expect(h.props.incognito).toBe(true);
  expect(h.props.onMessage).toBeUndefined();
  expect(h.props.mediaCapturePermissionGrantType).toBe("prompt");
  expect(h.props.onShouldStartLoadWithRequest({ url: uri })).toBe(true);
  const url = returnUrl + "?response=fixture";
  expect(h.props.onShouldStartLoadWithRequest({ url })).toBe(false);
  h.props.onNavigationStateChange({ url });
  expect(done).toHaveBeenCalledTimes(1);
  expect(done).toHaveBeenCalledWith(url);
  expect(error).not.toHaveBeenCalled();
});
it("blocks external navigation and exposes provider process failure", async () => {
  const error = vi.fn();
  await act(async () =>
    root.render(
      <KycProvider
        uri="https://verify.aliyun.com/start"
        returnUrl="https://app.test/kyc"
        title="Verify"
        onReturn={vi.fn()}
        onError={error}
      />
    )
  );
  expect(h.props.onShouldStartLoadWithRequest({ url: "https://foreign.test" })).toBe(false);
  h.props.onRenderProcessGone();
  expect(error).toHaveBeenCalledTimes(2);
});
it("rejects malformed SDK messages and settles only once", async () => {
  const ready = vi.fn(),
    error = vi.fn();
  await act(async () => root.render(<KycMetadata onReady={ready} onError={error} />));
  h.props.onMessage({ nativeEvent: { data: '{"type":"meta","metaInfo":"[]"}' } });
  h.props.onMessage({ nativeEvent: { data: '{"type":"meta","metaInfo":"{}"}' } });
  expect(error).toHaveBeenCalledTimes(1);
  expect(ready).not.toHaveBeenCalled();
});
