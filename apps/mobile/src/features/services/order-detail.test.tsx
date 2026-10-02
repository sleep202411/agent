import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { order } from "./order-detail-fixture.test-helper";
import { OrderDetail } from "./order-detail";
vi.mock("@/features/services/user-displays", () => ({ useUserDisplays: () => new Map() }));
const h = vi.hoisted(() => ({
  send: vi.fn(),
  load: vi.fn(),
  push: vi.fn(),
  gate: vi.fn(),
  generation: 1,
  userId: "buyer",
  authenticated: true,
  active: true,
}));

vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
vi.mock("./order-detail-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./order-detail-api")>()),
  transitionOrder: h.send,
  fetchOrder: h.load,
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: h.push }),
  Stack: { Screen: () => null },
  useIsFocused: () => true,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.authenticated ? "authenticated" : "anonymous",
    generation: h.generation,
    user: { id: h.userId },
  }),
  useAuthGate: () => ({ requireAuth: h.gate }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
const translate = (key: string) => key;
vi.mock("@/i18n", () => ({
  useTranslations: () => translate,
  useLocale: () => "en-US",
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
const render = () => act(async () => root.render(<OrderDetail id="order" />));
const click = (text: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => b.textContent === text)!
    .click();
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.userId = "creator";
  h.authenticated = true;
  h.active = true;
  h.load.mockResolvedValue(order);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("requires confirmation, admits one rapid action and displays returned status", async () => {
  h.send.mockResolvedValue({ ...order, status: "in_progress" });
  await render();
  expect(host.textContent).toContain("A film");
  await act(async () => click("orderDetail.action.accept"));
  expect(h.send).not.toHaveBeenCalled();
  await act(async () => {
    click("orderDetail.confirm");
    click("orderDetail.confirm");
  });
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("orders.status.in_progress");
});
it("requires a reason before cancellation", async () => {
  await render();
  await act(async () => click("orderDetail.action.cancel"));
  const confirm = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === "orderDetail.confirm"
  )!;
  expect(confirm.disabled).toBe(true);
});
it("suppresses an old account mutation result after a session change", async () => {
  let finish!: (value: unknown) => void;
  h.send.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await act(async () => click("orderDetail.action.accept"));
  await act(async () => click("orderDetail.confirm"));
  h.generation = 2;
  h.userId = "buyer";
  await render();
  await act(async () => finish({ ...order, status: "in_progress" }));
  expect(host.textContent).toContain("orders.status.pending_creator");
  expect(host.textContent).not.toContain("orders.status.in_progress");
});
it("does not fetch for guests", async () => {
  h.authenticated = false;
  await render();
  expect(h.load).not.toHaveBeenCalled();
  await act(async () => click("orders.signIn"));
  expect(h.gate).toHaveBeenCalled();
});

it("requires a fresh read after a failed transition without automatically retrying it", async () => {
  h.send.mockRejectedValue(new Error("Cannot accept a cancelled order"));
  await render();
  await act(async () => click("orderDetail.action.accept"));
  await act(async () => click("orderDetail.confirm"));
  expect(host.textContent).toContain("Cannot accept a cancelled order");
  expect(host.textContent).not.toContain("orders.status.pending_creator");
  expect(host.textContent).not.toContain("orderDetail.confirm");
  expect(h.send).toHaveBeenCalledTimes(1);
  h.load.mockResolvedValue({ ...order, status: "cancelled" });
  await act(async () => click("orderDetail.refresh"));
  expect(host.textContent).toContain("orders.status.cancelled");
  expect(host.textContent).not.toContain("orderDetail.action.accept");
});

it.each(["denied", "foreign response"])(
  "removes stale order details when refresh returns %s",
  async (failure) => {
    await render();
    expect(host.textContent).toContain("A film");
    if (failure === "denied") h.load.mockRejectedValue(new Error("Access revoked"));
    else h.load.mockResolvedValue({ ...order, buyerId: "other-buyer", creatorId: "other-creator" });
    await act(async () => click("orderDetail.refresh"));
    expect(host.textContent).not.toContain("A film");
    expect(host.textContent).not.toContain("orderDetail.action.accept");
    expect(h.send).not.toHaveBeenCalled();
    h.load.mockResolvedValue(order);
    await act(async () => click("orderDetail.refresh"));
    expect(host.textContent).toContain("A film");
  }
);

const typeReason = async (text: string) => {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
it("keeps the action draft across a return but waits for renewed access before confirmation", async () => {
  await render();
  await act(async () => click("orderDetail.action.cancel"));
  await typeReason("The delivery schedule changed");
  h.active = false;
  await render();
  expect(host.textContent).not.toContain("A film");
  let finish!: (value: unknown) => void;
  h.load.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  h.active = true;
  await render();
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).not.toContain("orderDetail.confirm");
  await act(async () => finish({ ...order, version: 2 }));
  expect(host.querySelector("input")?.value).toBe("The delivery schedule changed");
  expect(h.send).not.toHaveBeenCalled();
  h.send.mockResolvedValue({ ...order, status: "cancelled", version: 3 });
  await act(async () => click("orderDetail.confirm"));
  expect(h.send).toHaveBeenCalledWith(
    expect.objectContaining({ version: 2 }),
    "creator",
    "cancel",
    "The delivery schedule changed"
  );
});
it("drops an obsolete confirmation when another party completed the order during absence", async () => {
  await render();
  await act(async () => click("orderDetail.action.cancel"));
  await typeReason("Draft reason");
  h.active = false;
  await render();
  h.load.mockResolvedValue({ ...order, status: "completed", version: 2 });
  h.active = true;
  await render();
  expect(host.textContent).toContain("orders.status.completed");
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).not.toContain("orderDetail.confirm");
  expect(h.send).not.toHaveBeenCalled();
});
it("retains the reason through failed refresh without exposing stale actions", async () => {
  await render();
  await act(async () => click("orderDetail.action.decline"));
  await typeReason("Unable to meet the brief");
  h.load.mockRejectedValue(new Error("Access check unavailable"));
  await act(async () => click("orderDetail.refresh"));
  expect(host.textContent).toContain("Access check unavailable");
  expect(host.querySelector("input")).toBeNull();
  h.load.mockResolvedValue(order);
  await act(async () => click("orderDetail.refresh"));
  expect(host.querySelector("input")?.value).toBe("Unable to meet the brief");
  expect(h.send).not.toHaveBeenCalled();
});
it("ignores an in-flight action receipt after leaving and returning to a fresh order", async () => {
  let finish!: (value: unknown) => void;
  h.send.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await act(async () => click("orderDetail.action.accept"));
  await act(async () => click("orderDetail.confirm"));
  h.active = false;
  await render();
  h.load.mockResolvedValue({ ...order, status: "cancelled", version: 3 });
  h.active = true;
  await render();
  await act(async () => finish({ ...order, status: "in_progress", version: 2 }));
  expect(host.textContent).toContain("orders.status.cancelled");
  expect(host.textContent).not.toContain("orders.status.in_progress");
  expect(h.send).toHaveBeenCalledTimes(1);
});
