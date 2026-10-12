import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextVideoControl } from "./next-video-control";
const h = vi.hoisted(() => ({ find: vi.fn(), replace: vi.fn(), generation: 1, active: true }));
vi.mock("./next-video", () => ({ findNextVideo: h.find }));
vi.mock("expo-router", () => ({ useRouter: () => ({ replace: h.replace }) }));
vi.mock("@/auth", () => ({ useAuth: () => ({ generation: h.generation }) }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/lib/navigation", () => ({ toHref: (p: string) => p }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
let root: Root, host: HTMLDivElement;
const render = () => act(async () => root.render(<NextVideoControl ipId="current" />));
const click = () => act(async () => host.querySelector("button")!.click());
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("loads only on request and replaces the route with an access-checked playback intent", async () => {
  h.find.mockResolvedValue("next");
  await render();
  expect(h.find).not.toHaveBeenCalled();
  await click();
  expect(h.replace).toHaveBeenCalledWith("/ip/next?watch=1");
});
it("retains current playback on error and offers explicit retry", async () => {
  h.find.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue("next");
  await render();
  await click();
  expect(host.textContent).toContain("Unavailable");
  expect(h.replace).not.toHaveBeenCalled();
  await click();
  expect(h.replace).toHaveBeenCalledTimes(1);
});
it("shows end of catalogue without wrapping", async () => {
  h.find.mockResolvedValue(null);
  await render();
  await click();
  expect(host.textContent).toContain("ipDetail.noNextVideo");
  expect(host.querySelector("button")!.disabled).toBe(true);
  expect(h.replace).not.toHaveBeenCalled();
});
it.each(["background", "account"])("ignores a late next-page result after %s", async (reason) => {
  let finish!: (v: string) => void;
  h.find.mockImplementation(() => new Promise((r) => (finish = r)));
  await render();
  await click();
  const signal = h.find.mock.calls[0][1] as AbortSignal;
  if (reason === "background") h.active = false;
  else h.generation = 2;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => finish("late"));
  expect(h.replace).not.toHaveBeenCalled();
});
