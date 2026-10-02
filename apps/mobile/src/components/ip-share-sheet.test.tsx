import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ShareSheet } from "./ip-share-sheet";
const m = vi.hoisted(() => ({
  ready: null as null | (() => void),
  capture: vi.fn(),
  failed: null as null | (() => void),
  share: vi.fn(),
  copy: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: m.copy }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: m.share }));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Alert: { alert: m.alert },
  StyleSheet: { create: (x: unknown) => x, absoluteFill: {} },
  useWindowDimensions: () => ({ width: 400, height: 800 }),
  View: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: any) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("react-native-view-shot", () => ({ captureRef: m.capture }));
vi.mock("@/constants/theme", () => ({ Spacing: { four: 16, five: 20 } }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ brand: "red" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("./ip-share-card", () => ({
  CARD_HEIGHT: 400,
  CARD_WIDTH: 360,
  ShareCard: ({ onPosterReady, onPosterError }: any) => {
    m.failed = onPosterError;
    m.ready = onPosterReady;
    return null;
  },
}));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const ip = { id: "one", title: "Title", coverUrl: "poster-one" } as any;
async function render(visible = true, coverUrl = "poster-one") {
  await act(async () =>
    root.render(
      <ShareSheet
        visible={visible}
        ip={{ ...ip, coverUrl }}
        shareUrl="https://example.test/ip"
        onClose={() => {}}
      />
    )
  );
}
async function click() {
  await act(async () => {
    host.querySelector<HTMLButtonElement>('[aria-label="ipDetail.share"]')!.click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 0));
  m.copy.mockReset().mockResolvedValue(true);
  m.alert.mockReset();
  m.capture.mockReset().mockResolvedValue("file://card");
  m.share.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("waits for the newly mounted poster after reopening", async () => {
  await render();
  m.ready!();
  await render(false);
  await render();
  await click();
  expect(m.capture).not.toHaveBeenCalled();
  await act(async () => {
    m.ready!();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(m.capture).toHaveBeenCalledOnce();
});
it("waits for a replacement poster", async () => {
  await render();
  m.ready!();
  await render(true, "poster-two");
  await click();
  expect(m.capture).not.toHaveBeenCalled();
});
it("does not export a blank poster on timeout", async () => {
  await render();
  await click();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10001);
  });
  expect(m.capture).not.toHaveBeenCalled();
  expect(m.share).not.toHaveBeenCalled();
  expect(host.textContent).toContain("ipDetail.sharePosterFailed");
});

it("does not capture after the sheet closes during image loading", async () => {
  await render();
  await click();
  await render(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10001);
  });
  expect(m.capture).not.toHaveBeenCalled();
  expect(m.share).not.toHaveBeenCalled();
});
it("does not open a late share after capture completes on a closed sheet", async () => {
  let finish!: (value: string) => void;
  m.capture.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  m.ready!();
  await click();
  await render(false);
  await act(async () => finish("file://late"));
  expect(m.share).not.toHaveBeenCalled();
});
it("retries a failed image and rejects stale image callbacks", async () => {
  await render();
  const oldReady = m.ready!;
  await act(async () => m.failed!());
  await click();
  expect(host.textContent).toContain("ipDetail.sharePosterFailed");
  await click();
  await act(async () => oldReady());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(m.capture).not.toHaveBeenCalled();
  await act(async () => m.ready!());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(m.capture).toHaveBeenCalledOnce();
  expect(m.share).toHaveBeenCalledOnce();
});
it("serializes taps before the busy state rerenders", async () => {
  await render();
  m.ready!();
  await act(async () => {
    const button = host.querySelector<HTMLButtonElement>('[aria-label="ipDetail.share"]')!;
    button.click();
    button.click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(m.capture).toHaveBeenCalledOnce();
  expect(m.share).toHaveBeenCalledOnce();
});

it("copies the exact link without waiting for or capturing the poster", async () => {
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="ipDetail.copyLink"]')!.click()
  );
  expect(m.copy).toHaveBeenCalledExactlyOnceWith("https://example.test/ip");
  expect(m.capture).not.toHaveBeenCalled();
  expect(m.alert).toHaveBeenCalledWith("ipDetail.linkCopied");
});
it("does not claim success when the clipboard rejects the link", async () => {
  m.copy.mockResolvedValue(false);
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="ipDetail.copyLink"]')!.click()
  );
  expect(m.alert).toHaveBeenCalledWith("ipDetail.copyLinkFailed", "ipDetail.copyLinkFailed");
});
