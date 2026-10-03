import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TextAdventures } from "./text-adventures";
import { TextAdventurePreview } from "./text-adventure-preview";
const h = vi.hoisted(() => ({
  status: "authenticated",
  generation: 1,
  focused: true,
  library: vi.fn(),
  player: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: h.generation, user: { id: "123" } }),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./text-adventure-library", () => ({
  TextAdventureLibrary: (props: unknown) => {
    h.library(props);
    return <span>library</span>;
  },
}));
vi.mock("./text-adventure-player", () => ({
  TextAdventurePlayer: (props: { onBack: () => void }) => {
    h.player(props);
    return <button onClick={props.onBack}>player</button>;
  },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  h.status = "authenticated";
  h.generation = 1;
  h.focused = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = () => act(async () => root.render(<TextAdventures onClose={h.close} />));
it("preserves the hub library entry and close navigation", async () => {
  await render();
  expect(h.library).toHaveBeenCalledWith({ session: { userId: "123", generation: 1 } });
  await act(async () => host.querySelector("button")!.click());
  expect(h.close).toHaveBeenCalledOnce();
});
it("unmounts the library when the route loses focus or signed out", async () => {
  await render();
  h.focused = false;
  await render();
  expect(host.textContent).not.toContain("library");
  h.focused = true;
  h.status = "anonymous";
  await render();
  expect(host.textContent).not.toContain("library");
});
it("routes the library preview through the recovery-aware player", async () => {
  const account = { userId: "123", generation: 1 };
  await act(async () =>
    root.render(
      <TextAdventurePreview gameId="tg_0123456789abcdef" session={account} onBack={h.close} />
    )
  );
  expect(h.player).toHaveBeenCalledWith({
    gameId: "tg_0123456789abcdef",
    account,
    onBack: h.close,
    backLabel: "textAdventures.actions.backToLibrary",
  });
  await act(async () => host.querySelector("button")!.click());
  expect(h.close).toHaveBeenCalledOnce();
});
