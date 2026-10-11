import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
// Explicit platform imports exercise both implementations in this test.
// eslint-disable-next-line import/no-duplicates
import { EnrollmentFrame } from "./enrollment-frame";
// eslint-disable-next-line import/no-duplicates
import { EnrollmentFrame as WebFrame } from "./enrollment-frame.web";
import { isEnrollmentCallback, allowEnrollmentNavigation } from "./enrollment-frame-policy";
const h = vi.hoisted(() => ({ props: null as any }));
vi.mock("react-native-webview", () => ({
  WebView: (p: any) => {
    h.props = p;
    return null;
  },
}));
const props = {
  uri: "https://provider.example/session?private=token",
  characterId: "character",
  callbackOrigin: "https://studio.fizzdragon.com",
  title: "Verification",
  onComplete: vi.fn(),
  onError: vi.fn(),
};
it("isolates the native provider from app credentials and blocks unapproved navigation/popups", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<EnrollmentFrame {...props} />));
    expect(h.props.source).toEqual({ uri: props.uri });
    expect(h.props.incognito).toBe(true);
    expect(h.props.sharedCookiesEnabled).toBe(false);
    expect(h.props.injectedJavaScript).toBeUndefined();
    expect(h.props.onMessage).toBeUndefined();
    expect(h.props.mediaCapturePermissionGrantType).toBe("prompt");
    expect(h.props.onShouldStartLoadWithRequest({ url: "https://provider.example/next" })).toBe(
      true
    );
    expect(h.props.onShouldStartLoadWithRequest({ url: "https://evil.example/" })).toBe(false);
    expect(
      h.props.onShouldStartLoadWithRequest({
        url: "https://studio.fizzdragon.com/characters/character?enrollment=callback",
      })
    ).toBe(false);
    expect(props.onComplete).toHaveBeenCalledTimes(1);
    h.props.onOpenWindow({ nativeEvent: { targetUrl: "https://evil.example" } });
    expect(props.onError).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});
it("rejects callback host/path/character/region spoofing and unsafe schemes", () => {
  for (const url of [
    "https://studio.fizzdragon.com.evil/characters/character?enrollment=callback",
    "https://studio.fizzdragon.com/characters/other?enrollment=callback",
    "https://studio.fizzspace.cn/characters/character?enrollment=callback",
    "https://user:password@studio.fizzdragon.com/characters/character?enrollment=callback",
    "http://studio.fizzdragon.com/characters/character?enrollment=callback",
    "https://studio.fizzdragon.com/characters/character",
  ])
    expect(isEnrollmentCallback(url, props.characterId, props.callbackOrigin)).toBe(false);
  for (const url of [
    "javascript:alert(1)",
    "file:///secret",
    "intent://camera",
    "https://provider.example.evil/",
    "https://u:p@provider.example",
    "http://provider.example",
  ])
    expect(allowEnrollmentNavigation(url, props.uri)).toBe(false);
  expect(
    isEnrollmentCallback(
      "https://studio.fizzdragon.com/zh-HK/characters/character/?enrollment=callback",
      props.characterId,
      props.callbackOrigin
    )
  ).toBe(true);
});
it("accepts Web callbacks only from the exact embedded window and official origin", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    complete = vi.fn();
  try {
    await act(async () => root.render(<WebFrame {...props} onComplete={complete} />));
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("allow")).toBe("camera; microphone");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-popups");
    const data = { type: "character-enrollment-callback", characterId: props.characterId };
    for (const init of [
      { source: window, origin: props.callbackOrigin, data },
      { source: frame.contentWindow, origin: "https://evil.example", data },
      {
        source: frame.contentWindow,
        origin: props.callbackOrigin,
        data: { ...data, characterId: "other" },
      },
    ])
      window.dispatchEvent(new MessageEvent("message", init));
    expect(complete).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: props.callbackOrigin,
        data,
      })
    );
    expect(complete).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
