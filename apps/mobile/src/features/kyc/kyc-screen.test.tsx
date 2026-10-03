import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { KycSession } from "./kyc-screen";
const h = vi.hoisted(() => ({
  generation: 1,
  raw: "null",
  status: vi.fn(),
  start: vi.fn(),
  confirm: vi.fn(),
  refresh: vi.fn(),
  ready: undefined as undefined | ((v: string) => void),
  returned: undefined as undefined | ((v: string) => void),
}));
vi.mock("@/auth", () => ({
  refreshCurrentUser: h.refresh,
  useAuth: vi.fn(),
  useAuthGate: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config", () => ({
  appEnv: { appRegion: "cn" },
  webBaseUrl: "https://fizzdragon.fizzspace.cn",
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null }, useIsFocused: () => true }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: () => ({
    read: () => h.raw,
    write: (v: string) => {
      h.raw = v;
    },
  }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "zh-CN" }));
vi.mock("./kyc-api", async (original) => ({
  ...(await original<typeof import("./kyc-api")>()),
  loadKycStatus: h.status,
  startKyc: h.start,
  confirmKyc: h.confirm,
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./kyc-provider", () => ({
  KycMetadata: ({ onReady }: { onReady: (v: string) => void }) => {
    h.ready = onReady;
    return null;
  },
  KycProvider: ({ onReturn }: { onReturn: (v: string) => void }) => {
    h.returned = onReturn;
    return <span>provider</span>;
  },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (v: string) => void;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
let root: Root, host: HTMLDivElement;
const mount = () =>
  act(async () =>
    root.render(
      <StrictMode>
        <KycSession userId="actor" generation={1} />
      </StrictMode>
    )
  );
const click = (label: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
const input = (label: string, value: string) =>
  act(async () => {
    const e = host.querySelector(`[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(e, value);
    e.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  h.generation = 1;
  h.raw = "null";
  h.status.mockResolvedValue({ needAuth: true });
  h.start.mockResolvedValue({
    certifyId: "attempt",
    certifyUrl: "https://verify.aliyun.com/start",
  });
  h.confirm.mockResolvedValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("recovers a stored attempt by confirming and refreshing the profile without restarting", async () => {
  h.raw = JSON.stringify({ certifyId: "attempt" });
  await mount();
  await click("kyc.checkStatus");
  expect(h.confirm).toHaveBeenCalledWith("attempt", 1, expect.any(AbortSignal));
  expect(h.refresh).toHaveBeenCalledTimes(1);
  expect(h.start).not.toHaveBeenCalled();
  expect(h.raw).toBe("null");
  expect(host.textContent).toContain("kyc.completedTitle");
});
it("keeps a failed confirmation available for retry", async () => {
  h.raw = JSON.stringify({ certifyId: "attempt" });
  h.confirm.mockRejectedValueOnce(new Error("Provider unavailable"));
  await mount();
  await click("kyc.checkStatus");
  expect(host.textContent).toContain("Provider unavailable");
  expect(h.raw).toContain("attempt");
  await click("kyc.checkStatus");
  expect(host.textContent).toContain("kyc.completedTitle");
});
it("checkpoints an uncertain start without storing identity details or allowing an automatic repeat", async () => {
  h.start.mockRejectedValue(new Error("Connection lost"));
  await mount();
  await act(async () => h.ready!("{}"));
  await input("kyc.nameLabel", "Test person");
  await input("kyc.certNoLabel", "0".repeat(18));
  await click("kyc.start");
  expect(h.raw).toBe("{}");
  expect(h.start).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("kyc.pendingRecovery");
  expect(host.querySelector("input")).toBeNull();
});
it("clears identity inputs and matches a returned success before backend confirmation", async () => {
  await mount();
  await act(async () => h.ready!("{}"));
  await input("kyc.nameLabel", "Test person");
  await input("kyc.certNoLabel", "0".repeat(18));
  await click("kyc.start");
  expect(h.raw).toBe('{"certifyId":"attempt"}');
  expect(host.textContent).toContain("provider");
  await act(async () =>
    h.returned!(
      "https://fizzdragon.fizzspace.cn/zh-CN/kyc?response=" +
        encodeURIComponent(JSON.stringify({ code: "1000", extInfo: { certifyId: "attempt" } }))
    )
  );
  expect(h.confirm).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("kyc.completedTitle");
});
