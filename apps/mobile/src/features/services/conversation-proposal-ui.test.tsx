import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ConversationProposal, ConversationProposalEditor } from "./conversation-proposal-ui";
import type { NativeConversation, NativeMessage } from "./conversation-api";

const h = vi.hoisted(() => ({
  change: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(),
  user: "owner",
  generation: 1,
  authenticated: true,
}));
vi.mock("./conversation-proposals", async (original) => ({
  ...(await original<typeof import("./conversation-proposals")>()),
  sendProposal: h.change,
  acceptProposal: h.accept,
  declineProposal: h.decline,
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.authenticated ? "authenticated" : "anonymous",
    generation: h.generation,
    user: { id: h.user },
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Switch: ({
    value,
    onValueChange,
    disabled,
  }: {
    value: boolean;
    onValueChange: (value: boolean) => void;
    disabled: boolean;
  }) => (
    <input
      type="checkbox"
      checked={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.checked)}
    />
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (text: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;

vi.mock("@/config", () => ({ appEnv: { siteRegion: "global" } }));
const conversation: NativeConversation = {
  id: "chat",
  contextId: "service",
  contextType: "service",
  participants: [
    { userId: "buyer", role: "buyer", lastReadMessageId: null },
    { userId: "creator", role: "creator", lastReadMessageId: null },
  ],
  lastMessage: null,
  lastMessageAt: "now",
  createdAt: "now",
  unreadCount: 0,
};
const message: NativeMessage = {
  id: "offer",
  conversationId: "chat",
  authorId: "creator",
  type: "proposal",
  body: "Offer",
  createdAt: "now",
  payload: {
    kind: "proposal",
    proposal: {
      status: "open",
      packageTier: "basic",
      price: 12.5,
      currency: "USD",
      deliveryDays: 3,
      revisions: -1,
      scope: ["Edit"],
      note: "Offer",
    },
  },
};
const click = (label: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((button) => button.textContent === label)!
    .click();
const card = (userId = "buyer", context = conversation) =>
  act(async () =>
    root.render(
      <ConversationProposal
        conversation={context}
        message={message}
        userId={userId}
        refresh={h.refresh}
        openOrder={h.open}
      />
    )
  );
const editor = () =>
  act(async () =>
    root.render(
      <ConversationProposalEditor
        conversation={conversation}
        userId="creator"
        refresh={h.refresh}
      />
    )
  );
const type = (label: string, value: string) => {
  const input = host.querySelector(`input[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("confirms before accepting and suppresses duplicate taps", async () => {
  let finish!: (value: unknown) => void;
  h.accept.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await card();
  expect(host.textContent).toContain("12.50");
  expect(host.textContent).toContain("thread.unlimited");
  await act(async () => click("thread.accept"));
  expect(h.accept).not.toHaveBeenCalled();
  await act(async () => {
    click("myServices.confirm");
    click("myServices.confirm");
  });
  expect(h.accept).toHaveBeenCalledTimes(1);
  await act(async () => finish({ id: "order", buyerId: "buyer" }));
  expect(h.open).toHaveBeenCalledWith("order");
});
it("hides decisions from creators and converted order threads", async () => {
  await card("creator");
  expect(host.textContent).not.toContain("thread.accept");
  await card("buyer", { ...conversation, contextType: "order" });
  expect(host.textContent).not.toContain("thread.accept");
});
it("shows decline failures and suppresses old-account success", async () => {
  h.decline.mockRejectedValue(new Error("Proposal already closed"));
  await card();
  await act(async () => click("thread.decline"));
  await act(async () => click("myServices.confirm"));
  expect(host.textContent).toContain("Proposal already closed");
  h.refresh.mockClear();
  let finish!: (value: unknown) => void;
  h.decline.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => click("myServices.confirm"));
  h.generation = 2;
  await act(async () => finish(message));
  expect(h.refresh).not.toHaveBeenCalled();
});
it("retains exact offer terms and idempotency key across retry", async () => {
  h.change.mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce(message);
  await editor();
  await act(async () => click("thread.sendProposal"));
  expect(
    Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "thread.sendProposal"
    )!.disabled
  ).toBe(true);
  await act(async () => {
    type("servicePackages.price", "12.5");
    type("servicePackages.deliveryDays", "3");
    type("servicePackages.revisions", "-1");
    type("servicePackages.scope", "Edit");
  });
  await act(async () => click("thread.sendProposal"));
  expect(host.textContent).toContain("Network error");
  expect(host.querySelector("input")!.disabled).toBe(true);
  await act(async () => click("inbox.retry"));
  expect(h.change).toHaveBeenCalledTimes(2);
  expect(h.change.mock.calls[1]).toEqual(h.change.mock.calls[0]);
  expect(h.change.mock.calls[0][2]).toMatchObject({ price: 12.5, revisions: -1 });
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
