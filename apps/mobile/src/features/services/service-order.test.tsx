import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { service } from "./order-fixture.test-helper";
import { ServiceOrder } from "./service-order";
const h = vi.hoisted(() => ({
  send: vi.fn(),
  push: vi.fn(),
  gate: vi.fn(),
  generation: 1,
  userId: "buyer",
  authenticated: true,
}));
vi.mock("./inquiry-api", () => ({ sendServiceInquiry: h.send, inquiryKey: () => "stable-key" }));
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
vi.mock("./order-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./order-api")>()),
  submitServiceOrder: h.send,
}));
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
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
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
  act(async () => root.render(<ServiceOrder service={{ ...service, status }} />));
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
  await act(async () => click("serviceOrder.title"));
  await act(async () => type("A film"));
}
it("guards required answers and submits one request on rapid taps", async () => {
  h.send.mockResolvedValue("order/id");
  await render();
  await act(async () => click("serviceOrder.title"));
  await act(async () => click("serviceOrder.submit"));
  expect(h.send).not.toHaveBeenCalled();
  await act(async () => type("A film"));
  await act(async () => {
    click("serviceOrder.submit");
    click("serviceOrder.submit");
  });
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(h.send.mock.calls[0][0].expectedServiceVersion).toBe(3);
  await act(async () => click("serviceOrder.open"));
  expect(h.push).toHaveBeenCalledWith("/order/order%2Fid");
});
it("retries the identical request after network failure and freezes its inputs", async () => {
  h.send.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("order");
  await compose();
  await act(async () => click("serviceOrder.submit"));
  expect(host.querySelector("input")!.disabled).toBe(true);
  await act(async () => click("serviceOrder.submit"));
  expect(h.send.mock.calls[0][0]).toEqual(h.send.mock.calls[1][0]);
});
it("ignores old-account completion and resets the questionnaire", async () => {
  let finish!: (id: string) => void;
  h.send.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await compose();
  await act(async () => click("serviceOrder.submit"));
  h.generation = 2;
  await render();
  await act(async () => finish("old"));
  expect(host.querySelector("input")!.value).toBe("");
  expect(host.textContent).not.toContain("serviceOrder.sent");
});
it("requires sign-in and hides order entry for the owner or an unlisted service", async () => {
  h.authenticated = false;
  await render();
  await act(async () => click("serviceOrder.title"));
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
