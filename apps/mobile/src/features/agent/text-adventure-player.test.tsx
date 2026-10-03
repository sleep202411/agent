import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TextAdventurePlayer } from "./text-adventure-player";
const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  start: vi.fn(),
  send: vi.fn(),
  clear: vi.fn(),
  pending: null as unknown,
  generation: 1,
  active: true,
  focused: true,
  back: vi.fn(),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("./text-adventure-media", () => ({
  TextAdventureMedia: () => null,
  TextAdventureMusic: () => null,
}));
vi.mock("./text-adventure-play-workflow", () => ({
  textAdventurePlayWorkflow: () => ({
    refresh: h.refresh,
    start: h.start,
    send: h.send,
    clearUnknown: h.clear,
    read: () => h.pending,
  }),
}));
vi.mock("./text-adventure-editor", () => ({
  Action: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  TextInput: ({
    value,
    editable,
    onChangeText,
  }: {
    value: string;
    editable?: boolean;
    onChangeText: (value: string) => void;
  }) => <input value={value} disabled={!editable} onChange={(e) => onChangeText(e.target.value)} />,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const session = {
  gameId: "tg_0123456789abcdef",
  sessionId: "ts_0123456789abcdef",
  messages: [{ id: "1", role: "assistant", content: "Welcome" }],
};
const button = (suffix: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.endsWith(suffix))!;
const render = () =>
  act(async () =>
    root.render(
      <TextAdventurePlayer
        gameId={session.gameId}
        account={{ userId: "1", generation: 1 }}
        onBack={h.back}
      />
    )
  );
const type = async (text: string) =>
  act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.pending = null;
  h.generation = 1;
  h.active = true;
  h.focused = true;
  h.refresh.mockResolvedValue({ session, pending: null });
  h.start.mockResolvedValue(session);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("reads existing history and starts over only after confirmation", async () => {
  await render();
  expect(host.textContent).toContain("Welcome");
  expect(h.start).not.toHaveBeenCalled();
  await act(async () => button("playtest.restart").click());
  expect(h.start).not.toHaveBeenCalled();
  await act(async () => button("restartConfirm").click());
  expect(h.start).toHaveBeenCalledOnce();
});
it("blocks resending a lost action until recovery", async () => {
  h.send.mockImplementation(async () => {
    h.pending = { id: "pending", kind: "action", message: "Look" };
    throw new Error("Connection lost");
  });
  await render();
  await type("Look");
  await act(async () => button("playtest.send").click());
  expect(h.send).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Connection lost");
  expect(button("playtest.send").disabled).toBe(true);
  h.refresh.mockImplementation(async () => {
    h.pending = null;
    return { session, pending: null };
  });
  await act(async () => button("thread.refresh").click());
  expect(button("playtest.send").disabled).toBe(false);
});
it("requires explicit acknowledgement before clearing a pending action", async () => {
  h.pending = { id: "pending", kind: "action", message: "Look" };
  h.refresh.mockResolvedValue({ session, pending: h.pending });
  await render();
  await act(async () => button("clearPlay").click());
  expect(h.clear).not.toHaveBeenCalled();
  expect(host.textContent).toContain("clearPlayWarning");
  h.clear.mockImplementation(async () => {
    h.pending = null;
  });
  h.refresh.mockResolvedValue({ session, pending: null });
  const controls = [...host.querySelectorAll("button")].filter((b) =>
    b.textContent?.endsWith("clearPlay")
  );
  await act(async () => controls[1]!.click());
  expect(h.clear).toHaveBeenCalledWith("pending");
});
it("does not auto-start when there is no saved session", async () => {
  h.refresh.mockResolvedValue({ session: null, pending: null });
  await render();
  expect(h.start).not.toHaveBeenCalled();
  await act(async () => button("newSession").click());
  expect(h.start).toHaveBeenCalledWith(
    null,
    "en-US",
    expect.any(AbortSignal),
    expect.any(Function)
  );
});
it("aborts the current session lookup on unmount", async () => {
  let signal!: AbortSignal;
  h.refresh.mockImplementation((s: AbortSignal) => {
    signal = s;
    return new Promise(() => {});
  });
  await render();
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});

it("retains unsent text but reloads the session after backgrounding", async () => {
  await render();
  await type("Look behind the door");
  const signal = h.refresh.mock.calls[0][0] as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  expect(host.querySelector("input")).toBeNull();
  h.refresh.mockRejectedValueOnce(new Error("Session unavailable"));
  h.active = true;
  await render();
  expect(host.textContent).toContain("Session unavailable");
  expect(h.send).not.toHaveBeenCalled();
  await act(async () => button("thread.refresh").click());
  expect(host.querySelector("input")?.value).toBe("Look behind the door");
  expect(button("playtest.send").disabled).toBe(false);
  expect(h.send).not.toHaveBeenCalled();
});
it("retires unsent text when the route leaves", async () => {
  await render();
  await type("Private action");
  h.focused = false;
  await render();
  h.focused = true;
  await render();
  expect(host.querySelector("input")?.value).toBe("");
});
it("keeps recovered pending actions locked after foreground return", async () => {
  await render();
  await type("Look");
  h.send.mockImplementation(async () => {
    h.pending = { id: "pending", kind: "action", message: "Look" };
    throw new Error("Connection lost");
  });
  await act(async () => button("playtest.send").click());
  h.active = false;
  await render();
  h.refresh.mockResolvedValue({ session, pending: h.pending });
  h.active = true;
  await render();
  expect(host.querySelector("input")?.value).toBe("Look");
  expect(button("playtest.send").disabled).toBe(true);
  expect(h.send).toHaveBeenCalledOnce();
});
it("does not carry a draft into a new account generation", async () => {
  await render();
  await type("Private action");
  h.generation = 2;
  await act(async () =>
    root.render(
      <TextAdventurePlayer
        gameId={session.gameId}
        account={{ userId: "2", generation: 2 }}
        onBack={h.back}
      />
    )
  );
  expect(host.querySelector("input")?.value).toBe("");
});
