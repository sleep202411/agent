import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PublicIpReleaseLinks } from "./public-ip-release-links";
const h = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn(), generation: 1, active: true }));
vi.mock("@/auth", () => ({ useAuth: () => ({ generation: h.generation, status: "anonymous" }) }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: h.open }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const render = (id = "ip/a") => act(async () => root.render(<PublicIpReleaseLinks ipId={id} />));
const click = (label: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.get.mockResolvedValue({ links: [{ label: "Watch film", url: "https://example.com/watch" }] });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(async () => root.unmount()));
it("reads public links and opens only on explicit action", async () => {
  await render();
  expect(h.get).toHaveBeenCalledWith(
    "/ip-commerce/ips/ip%2Fa/release-links",
    expect.objectContaining({ credentials: "omit", retry: false })
  );
  expect(h.open).not.toHaveBeenCalled();
  await click("Watch film");
  expect(h.open).toHaveBeenCalledWith("https://example.com/watch");
});
it("hides an empty public section and exposes read failures with retry", async () => {
  h.get.mockRejectedValueOnce(Error("Unavailable"));
  await render();
  expect(host.textContent).toContain("Unavailable");
  h.get.mockResolvedValue({ links: [] });
  await click("common.retry");
  expect(host.textContent).toBe("");
});
it("rejects unsafe release URLs instead of rendering an actionable link", async () => {
  h.get.mockResolvedValue({ links: [{ label: "Unsafe", url: "javascript:alert(1)" }] });
  await render();
  expect(host.textContent).not.toContain("Unsafe");
  expect(h.open).not.toHaveBeenCalled();
  expect(host.textContent).toContain("common.retry");
});
it("retires stale IP and background reads", async () => {
  let resolve!: (v: unknown) => void;
  h.get.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  await render();
  h.active = false;
  await render();
  await act(async () => resolve({ links: [{ label: "Old", url: "https://example.com/old" }] }));
  expect(host.textContent).toBe("");
  h.active = true;
  await render("new");
  expect(host.textContent).not.toContain("Old");
  expect(host.textContent).toContain("Watch film");
});
it("shows browser-opening failures", async () => {
  h.open.mockRejectedValueOnce(Error("Browser unavailable"));
  await render();
  await click("Watch film");
  expect(host.textContent).toContain("Browser unavailable");
});
