import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KycMetadata, KycProvider } from "./kyc-provider.web";
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
let root: Root, host: HTMLDivElement;
const sdkWindow = window as Window & { getMetaInfo?: () => unknown };
const script = () => document.querySelector('script[src*="jsvm_all"]') as HTMLScriptElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  delete sdkWindow.getMetaInfo;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  delete sdkWindow.getMetaInfo;
  vi.useRealTimers();
});
it("collects metadata once and ignores the later timeout", async () => {
  const ready = vi.fn(),
    error = vi.fn();
  await act(async () => root.render(<KycMetadata onReady={ready} onError={error} />));
  sdkWindow.getMetaInfo = () => ({ device: "fixture" });
  act(() => script().dispatchEvent(new Event("load")));
  act(() => vi.advanceTimersByTime(15001));
  expect(ready).toHaveBeenCalledExactlyOnceWith('{"device":"fixture"}');
  expect(error).not.toHaveBeenCalled();
});
it("reports SDK failure and cleans up so a replacement can retry", async () => {
  const error = vi.fn(),
    ready = vi.fn();
  await act(async () => root.render(<KycMetadata key="first" onReady={ready} onError={error} />));
  const old = script();
  act(() => old.dispatchEvent(new Event("error")));
  expect(error).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<KycMetadata key="second" onReady={ready} onError={error} />));
  expect(old.isConnected).toBe(false);
  sdkWindow.getMetaInfo = () => ({});
  act(() => script().dispatchEvent(new Event("load")));
  expect(ready).toHaveBeenCalledExactlyOnceWith("{}");
});
it("retires abandoned metadata callbacks", async () => {
  const ready = vi.fn(),
    error = vi.fn();
  await act(async () => root.render(<KycMetadata onReady={ready} onError={error} />));
  const old = script();
  await act(async () => root.render(null));
  sdkWindow.getMetaInfo = () => ({});
  act(() => {
    old.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(16000);
  });
  expect(ready).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
it("opens the provider without an opener and requires explicit status recovery", async () => {
  const returned = vi.fn();
  await act(async () =>
    root.render(
      <KycProvider
        uri="https://verify.aliyun.com/flow"
        returnUrl="https://site.test/kyc"
        title="Verify"
        onReturn={returned}
        onError={vi.fn()}
      />
    )
  );
  const link = host.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("https://verify.aliyun.com/flow");
  expect(link.rel).toBe("noopener noreferrer");
  expect(link.target).toBe("_blank");
  expect(host.textContent).toContain("kyc.webReturnHint");
  expect(returned).not.toHaveBeenCalled();
});
it("does not expose unsafe provider URLs as links", async () => {
  const error = vi.fn();
  await act(async () =>
    root.render(
      <KycProvider
        uri="javascript:alert(1)"
        returnUrl="https://site.test/kyc"
        title="Verify"
        onReturn={vi.fn()}
        onError={error}
      />
    )
  );
  const link = host.querySelector("a")!;
  expect(link.hasAttribute("href")).toBe(false);
  act(() => link.click());
  expect(error).toHaveBeenCalledTimes(1);
});
