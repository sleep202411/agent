import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TextAdventureLibrary } from "./text-adventure-library";
const h = vi.hoisted(() => ({ list: vi.fn(), generation: 1, active: true }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("./text-adventure-preview", () => ({
  TextAdventurePreview: ({ gameId }: { gameId: string }) => <span>Preview {gameId}</span>,
}));
vi.mock("./text-adventure-player", () => ({
  TextAdventurePlayer: ({ onBack }: { onBack: () => void }) =>
    h.active ? <button onClick={onBack}>player back</button> : null,
}));
vi.mock("./text-adventure-create", () => ({ TextAdventureCreate: () => null }));
vi.mock("./api/text-adventure-api", () => ({ listTextAdventures: h.list }));
vi.mock("./text-adventure-editor", () => ({
  TextAdventureEditor: ({
    gameId,
    onBack,
    onPlay,
  }: {
    gameId: string;
    onBack: () => void;
    onPlay?: () => void;
  }) => (
    <div>
      <button onClick={onBack}>{gameId}</button>
      <button onClick={onPlay}>playtest</button>
    </div>
  ),
  Action: ({ onPress }: { onPress: () => void }) => <button onClick={onPress}>refresh</button>,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
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
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const session = { userId: "1", generation: 1 };
const render = () => act(async () => root.render(<TextAdventureLibrary session={session} />));
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.list.mockResolvedValue([
    { gameId: "tg_0123456789abcdef", name: "World", status: "draft", synopsis: "Story" },
  ]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("opens a selected draft and refreshes the library on return", async () => {
  await render();
  await act(async () => button("World").click());
  expect(host.textContent).toContain("tg_0123456789abcdef");
  await act(async () => button("tg_").click());
  expect(h.list).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("World");
});
it("shows load errors with an explicit retry", async () => {
  h.list.mockRejectedValueOnce(new Error("Forbidden"));
  await render();
  expect(host.textContent).toContain("Forbidden");
  await act(async () => button("refresh").click());
  expect(host.textContent).toContain("World");
});
it("does not navigate under a stale account", async () => {
  await render();
  h.generation = 2;
  await act(async () => button("World").click());
  expect(host.textContent).not.toContain("tg_");
});

it("opens native playtesting from the editor and returns to the editor", async () => {
  await render();
  await act(async () => button("World").click());
  await act(async () => button("playtest").click());
  expect(host.textContent).toContain("player back");
  await act(async () => button("player back").click());
  expect(host.textContent).toContain("tg_0123456789abcdef");
});

it("opens the saved preview from the library", async () => {
  await render();
  await act(async () => button("textAdventure.preview").click());
  expect(host.textContent).toContain("Preview tg_0123456789abcdef");
});

it("retains the selected editor across native picker background transitions", async () => {
  await render();
  await act(async () => button("World").click());
  const editorButton = button("tg_");
  h.active = false;
  await render();
  expect(button("tg_")).toBe(editorButton);
  h.active = true;
  await render();
  expect(button("tg_")).toBe(editorButton);
  expect(h.list).toHaveBeenCalledTimes(1);
});
it("suspends playtesting in the background and restores the selected player on return", async () => {
  await render();
  await act(async () => button("World").click());
  await act(async () => button("playtest").click());
  h.active = false;
  await render();
  expect(host.textContent).not.toContain("player back");
  h.active = true;
  await render();
  expect(host.textContent).toContain("player back");
});
