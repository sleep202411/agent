import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ConsentGate } from "./consent-gate";
const m = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), alert: vi.fn() }));
vi.mock("react-native", () => ({
  Alert: { alert: m.alert },
  BackHandler: { exitApp: vi.fn() },
  Platform: { OS: "android" },
  Modal: ({ visible, children }: any) => (visible ? <div>{children}</div> : null),
  Pressable: ({ onPress, children }: any) => <button onClick={onPress}>{children}</button>,
  View: ({ children }: any) => <div>{children}</div>,
  StyleSheet: { create: (x: unknown) => x },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/constants/theme", () => ({ Spacing: {} }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useLocale: () => "en-US", useTranslations: () => (s: string) => s }));
vi.mock("@/lib/legal", () => ({
  hasPrivacyConsent: m.read,
  setPrivacyConsent: m.write,
  openLegal: vi.fn(),
}));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
  m.write.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<ConsentGate />));
}
it("shows consent when storage cannot establish acceptance", async () => {
  m.read.mockRejectedValue(new Error("storage unavailable"));
  await render();
  expect(host.textContent).toContain("consent.title");
  expect(m.write).not.toHaveBeenCalled();
});
it("keeps the dialog hidden for saved consent", async () => {
  m.read.mockResolvedValue(true);
  await render();
  expect(host.textContent).toBe("");
});
it("shows missing consent and closes after successful acceptance", async () => {
  m.read.mockResolvedValue(false);
  await render();
  expect(host.textContent).toContain("consent.title");
  await act(async () => host.querySelector("button")!.click());
  expect(m.write).toHaveBeenCalledOnce();
  expect(host.textContent).toBe("");
});

it("reports persistence failure and keeps acceptance retryable", async () => {
  m.read.mockResolvedValue(false);
  m.write.mockRejectedValueOnce(new Error("save failed"));
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(m.alert).toHaveBeenCalledWith("save failed");
  expect(host.textContent).toContain("consent.title");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toBe("");
});
