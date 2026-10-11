import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Screen from "@/app/certificate-verify";
const h = vi.hoisted(() => ({ verify: vi.fn(), active: true }));
vi.mock("./verify-api", async (original) => ({
  ...(await original<typeof import("./verify-api")>()),
  verifyCertificate: h.verify,
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  TextInput: ({ value, onChangeText, editable }: any) => (
    <input value={value} disabled={!editable} onChange={(e) => onChangeText(e.target.value)} />
  ),
  Pressable: ({ children, disabled, onPress }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const number = "FD-OPC-2605-8K3Q7P";
const render = () => act(async () => root.render(<Screen />));
const fill = async () =>
  act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, number);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const submit = () => act(async () => host.querySelector("button")!.click());
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it.each(["valid", "revoked", "not_found"])("renders %s status", async (status) => {
  h.verify.mockResolvedValue({
    status,
    valid: status === "valid",
    certNo: number,
    certificate: null,
  });
  await render();
  await fill();
  await submit();
  expect(host.textContent).toContain(
    `certificateVerification.${status === "not_found" ? "notFound" : status}Title`
  );
});
it("serializes taps, aborts on blur and ignores late responses", async () => {
  let finish!: (value: unknown) => void;
  h.verify.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await fill();
  await act(async () => {
    host.querySelector("button")!.click();
    host.querySelector("button")!.click();
  });
  expect(h.verify).toHaveBeenCalledTimes(1);
  h.active = false;
  await render();
  expect(h.verify.mock.calls[0][1].aborted).toBe(true);
  await act(async () => finish({ status: "valid", certificate: null }));
  expect(host.textContent).not.toContain("certificateVerification.validTitle");
  h.active = true;
  await render();
  expect(host.querySelector("button")!.disabled).toBe(false);
});
it("clears previous success before showing a server error", async () => {
  h.verify
    .mockResolvedValueOnce({ status: "valid", certificate: null })
    .mockRejectedValueOnce(new Error("Rate limited"));
  await render();
  await fill();
  await submit();
  await submit();
  expect(host.textContent).toContain("Rate limited");
  expect(host.textContent).not.toContain("certificateVerification.validTitle");
});
