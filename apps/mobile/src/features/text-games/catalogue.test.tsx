import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TextGameCatalogue } from "./catalogue";
const h = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  gate: vi.fn(),
  generation: 1,
  status: "anonymous",
  active: true,
}));
vi.mock("./api", () => ({ listPublicTextGames: h.list, getPublicTextGame: h.get }));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    generation: h.generation,
    status: h.status,
    user: h.status === "authenticated" ? { id: "1" } : null,
  }),
  useAuthGate: () => ({ requireAuth: h.gate }),
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui", () => ({ PosterImage: () => null }));
vi.mock("@/features/agent/text-adventure-player", () => ({
  TextAdventurePlayer: ({ gameId, onBack }: { gameId: string; onBack: () => void }) => (
    <button onClick={onBack}>Player {gameId}</button>
  ),
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
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListEmptyComponent,
  }: {
    data: { gameId: string }[];
    renderItem: (v: { item: { gameId: string } }) => ReactNode;
    ListHeaderComponent: ReactNode;
    ListEmptyComponent: ReactNode;
  }) => (
    <div>
      {ListHeaderComponent}
      {data.length
        ? data.map((item) => <div key={item.gameId}>{renderItem({ item })}</div>)
        : ListEmptyComponent}
    </div>
  ),
}));
const id = "tg_0123456789abcdef";
let host: HTMLDivElement, root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const render = () => act(async () => root.render(<TextGameCatalogue active={h.active} />));
const click = (label: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.status = "anonymous";
  h.active = true;
  h.gate.mockReturnValue(false);
  h.list.mockResolvedValue([{ gameId: id, name: "World" }]);
  h.get.mockResolvedValue({ gameId: id, content: { name: "World", synopsis: "A story" } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("lets guests browse metadata and gates only playing", async () => {
  await render();
  await click("World");
  expect(host.textContent).toContain("A story");
  expect(h.gate).not.toHaveBeenCalled();
  await click("textGames.play");
  expect(h.gate).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("Player");
});
it("retains selected context across login focus changes", async () => {
  await render();
  await click("World");
  h.active = false;
  await render();
  h.generation = 2;
  h.status = "authenticated";
  h.active = true;
  h.gate.mockReturnValue(true);
  await render();
  expect(host.textContent).toContain("A story");
  await click("textGames.play");
  expect(host.textContent).toContain(`Player ${id}`);
});
it("stops playback on blur and revalidates when returning", async () => {
  h.status = "authenticated";
  h.gate.mockReturnValue(true);
  await render();
  await click("World");
  await click("textGames.play");
  h.active = false;
  await render();
  expect(host.textContent).not.toContain("Player");
  h.get.mockRejectedValue(new Error("Unpublished"));
  h.active = true;
  await render();
  expect(host.textContent).toContain("Unpublished");
  expect(host.textContent).not.toContain("textGames.play");
});
it("clears old results while refreshing and permits retry", async () => {
  await render();
  h.list.mockRejectedValueOnce(new Error("Offline"));
  await click("thread.refresh");
  expect(host.textContent).toContain("Offline");
  expect(host.textContent).not.toContain("World");
  await click("thread.refresh");
  expect(host.textContent).toContain("World");
});
it("discards late detail after returning to catalogue", async () => {
  let finish!: (v: unknown) => void;
  h.get.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("World");
  const signal = h.get.mock.calls[0][1];
  await click("textGames.backToCatalogue");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ content: { name: "Stale" } }));
  expect(host.textContent).not.toContain("Stale");
});
it("clears playback on account replacement", async () => {
  h.status = "authenticated";
  h.gate.mockReturnValue(true);
  await render();
  await click("World");
  await click("textGames.play");
  h.generation = 2;
  await render();
  expect(host.textContent).not.toContain("Player");
  expect(h.get).toHaveBeenCalledTimes(2);
});
