import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PublishedTextAdventure } from "./published-text-adventure";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  gate: vi.fn(),
  status: "anonymous",
  generation: 1,
  active: true,
  player: vi.fn(),
  media: vi.fn(),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => true }));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.status,
    generation: h.generation,
    user: h.status === "authenticated" ? { id: "22" } : undefined,
  }),
  useAuthGate: () => ({ requireAuth: h.gate }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/data/text-game-api", () => ({ getPublishedTextGame: h.get }));
vi.mock("@/data/text-game-share", () => ({
  textGameShareUrl: () => "https://site.example/en-US/play/text-game/tg_0123456789abcdef",
}));
vi.mock("@/features/experience-player/components/experience-share-button", () => ({
  ExperienceShareButton: () => null,
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui", () => ({ PosterImage: () => null }));
vi.mock("@/features/agent/text-adventure-media", () => ({
  TextAdventureMedia: () => {
    h.media();
    return <span>media</span>;
  },
}));
vi.mock("@/features/agent/text-adventure-player", () => ({
  TextAdventurePlayer: (props: { onBack: () => void }) => {
    h.player(props);
    return h.active ? <button onClick={props.onBack}>player</button> : null;
  },
}));
vi.mock("@/features/agent/text-adventure-editor", () => ({
  Action: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {label}
    </button>
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const gameId = "tg_0123456789abcdef";
const detail = {
  gameId,
  content: {
    name: "World",
    synopsis: "Explore",
    characters: [{ id: "1", name: "Guide", intro: "A traveller" }],
    stillUrls: [],
    bgmUrl: null,
  },
};
const render = () => act(async () => root.render(<PublishedTextAdventure gameId={gameId} />));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
beforeEach(() => {
  vi.resetAllMocks();
  h.status = "anonymous";
  h.generation = 1;
  h.active = true;
  h.get.mockResolvedValue(detail);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("shows public metadata to guests without opening login or player", async () => {
  await render();
  expect(host.textContent).toContain("WorldExplore");
  expect(host.textContent).toContain("Guide");
  expect(h.gate).not.toHaveBeenCalled();
  expect(h.player).not.toHaveBeenCalled();
});
it("preserves the selected story through login and uses public player access", async () => {
  await render();
  await act(async () => button("games.textPlay").click());
  expect(h.player).not.toHaveBeenCalled();
  h.status = "authenticated";
  h.generation = 2;
  await act(async () => h.gate.mock.calls[0][0].onAuthenticated());
  await render();
  expect(h.player.mock.calls.at(-1)?.[0]).toMatchObject({
    gameId,
    account: { userId: "22", generation: 2 },
    mode: "public",
  });
  await act(async () => button("player").click());
  expect(host.textContent).toContain("World");
});
it("unmounts private playback on inactivity and account change", async () => {
  h.status = "authenticated";
  h.gate.mockImplementation(({ onAuthenticated }) => {
    onAuthenticated();
    return true;
  });
  await render();
  await act(async () => button("games.textPlay").click());
  expect(host.textContent).toBe("player");
  h.active = false;
  await render();
  expect(host.textContent).not.toContain("player");
  expect(host.textContent).not.toContain("media");
  h.active = true;
  h.generation = 2;
  await render();
  expect(host.textContent).not.toContain("player");
});
it("retries public metadata errors without requesting player access", async () => {
  h.get.mockRejectedValueOnce(new Error("Withdrawn"));
  await render();
  expect(host.textContent).toContain("Withdrawn");
  await act(async () => button("common.retry").click());
  expect(host.textContent).toContain("World");
  expect(h.player).not.toHaveBeenCalled();
});
it("aborts a late metadata lookup when the route leaves", async () => {
  h.get.mockImplementation(() => new Promise(() => {}));
  await render();
  const signal = h.get.mock.calls[0][1] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
