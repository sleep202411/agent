import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ServiceContact } from "./service-contact";
const h = vi.hoisted(() => ({
  send: vi.fn(),
  push: vi.fn(),
  gate: vi.fn(),
  generation: 1,
  userId: "buyer",
  authenticated: true,
}));
vi.mock("./inquiry-api", () => ({ sendServiceInquiry: h.send, inquiryKey: () => "stable-key" }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }), useIsFocused: () => true }));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.authenticated ? "authenticated" : "anonymous",
    generation: h.generation,
    user: { id: h.userId },
  }),
  useAuthGate: () => ({ requireAuth: h.gate }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (text: string) => void;
    editable: boolean;
  }) => <input value={value} onChange={(e) => onChangeText(e.target.value)} disabled={!editable} />,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const render = (status = "listed") =>
  act(async () =>
    root.render(<ServiceContact serviceId="service" creatorId="creator" status={status} />)
  );
const click = (text: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => b.textContent === text)!
    .click();
function type(text: string) {
  const input = host.querySelector("input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.userId = "buyer";
  h.authenticated = true;
  h.gate.mockImplementation(({ onAuthenticated }: { onAuthenticated: () => void }) => {
    if (h.authenticated) onAuthenticated();
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function compose() {
  await render();
  await act(async () => click("serviceContact.title"));
  await act(async () => type("Hello"));
}
it("defers the composer to sign-in and hides contact for owners and unlisted services", async () => {
  h.authenticated = false;
  await render();
  await act(async () => click("serviceContact.title"));
  expect(h.gate).toHaveBeenCalled();
  expect(host.querySelector("input")).toBeNull();
  h.authenticated = true;
  h.userId = "creator";
  await render();
  expect(host.textContent).toBe("");
  h.userId = "buyer";
  await render("paused");
  expect(host.textContent).toBe("");
});
it("serializes rapid sends and opens the returned conversation", async () => {
  h.send.mockResolvedValue("conv/id");
  await compose();
  await act(async () => {
    click("serviceContact.send");
    click("serviceContact.send");
  });
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(h.send).toHaveBeenCalledWith("service", "Hello", "stable-key");
  await act(async () => click("serviceContact.open"));
  expect(h.push).toHaveBeenCalledWith("/conversation/conv%2Fid");
});
it("preserves text and idempotency identity for a retry", async () => {
  h.send.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("conv");
  await compose();
  await act(async () => click("serviceContact.send"));
  expect(host.querySelector("input")!.value).toBe("Hello");
  await act(async () => click("serviceContact.send"));
  expect(h.send.mock.calls[0]).toEqual(h.send.mock.calls[1]);
});
it("ignores late success after an account change and clears the draft", async () => {
  let finish!: (id: string) => void;
  h.send.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await compose();
  await act(async () => click("serviceContact.send"));
  h.generation = 2;
  await render();
  await act(async () => finish("old"));
  expect(host.querySelector("input")!.value).toBe("");
  expect(host.textContent).not.toContain("serviceContact.sent");
});
