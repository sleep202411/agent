import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewChat } from "./crew-chat";
const h = vi.hoisted(() => ({ get: vi.fn(), generation: 1, active: true }));
vi.mock("./conversation-api", () => ({ fetchCrewConversation: h.get }));
vi.mock("./native-conversation", () => ({
  NativeConversation: ({ id }: { id: string }) => <span>conversation {id}</span>,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-router", () => ({ useIsFocused: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
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
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const render = (channel: "team" | "community" = "team") =>
  act(async () =>
    root.render(<CrewChat crewId="crew" channel={channel} userId="user" generation={1} />)
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.get.mockResolvedValue({ id: "resolved" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("opens the resolved conversation and discards it on channel change", async () => {
  await render();
  expect(host.textContent).toContain("conversation resolved");
  expect(h.get.mock.calls[0].slice(0, 3)).toEqual(["crew", "team", "user"]);
  h.get.mockResolvedValue({ id: "community" });
  await render("community");
  expect(host.textContent).toContain("conversation community");
  expect(host.textContent).not.toContain("resolved");
  expect(h.get.mock.calls[0][3].aborted).toBe(true);
});
it("shows permission failures and retries only on request", async () => {
  h.get.mockRejectedValueOnce(new Error("Crew not found"));
  await render();
  expect(host.textContent).toContain("Crew not found");
  expect(host.textContent).not.toContain("conversation");
  h.get.mockResolvedValue({ id: "retried" });
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("conversation retried");
  expect(h.get).toHaveBeenCalledTimes(2);
});
it("ignores late account results and aborts in background", async () => {
  let finish!: (v: unknown) => void;
  h.get.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  h.generation = 2;
  await act(async () => finish({ id: "foreign" }));
  expect(host.textContent).not.toContain("foreign");
  h.active = false;
  await render();
  expect(h.get.mock.calls[0][3].aborted).toBe(true);
});
