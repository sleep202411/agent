import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FilmStore } from "./film-store";
import type { ExperienceGameSummary } from "@/data/interactive-film-api";
const h = vi.hoisted(() => ({
  listing: vi.fn(),
  latest: vi.fn(),
  restart: vi.fn(),
  play: vi.fn(),
  close: vi.fn(),
  active: true,
  generation: 1,
  status: "authenticated",
  t: (s: string) => s,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: h.status, generation: h.generation, user: { id: "user" } }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t, useLocale: () => "en-US" }));
vi.mock("expo-router", () => ({ useRouter: () => ({}) }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("./film-store-api", () => ({
  fetchFilmStoreListing: h.listing,
  restartPublishedFilm: h.restart,
}));
vi.mock("@/features/experience-player/api/story-saves-api", () => ({
  createStorySavesApi: () => ({ latest: h.latest }),
}));
vi.mock("@/features/experience-player/lib/play-game-href", () => ({ navigateToPlay: h.play }));
vi.mock("@/features/experience-player/lib/experience-share", () => ({
  buildExperiencePlayShareUrl: () => "https://example.com/share",
}));
vi.mock("@/features/experience-player/components/experience-share-button", () => ({
  ExperienceShareButton: () => <button>share</button>,
}));
vi.mock("expo", () => ({ useEvent: () => ({ status: "readyToPlay" }) }));
vi.mock("expo-video", () => ({
  useVideoPlayer: () => ({ pause: vi.fn() }),
  VideoView: () => <div>video</div>,
}));
vi.mock("expo-image", () => ({
  Image: ({ source, onError }: { source: { uri: string }; onError(): void }) => (
    <img src={source.uri} onError={onError} />
  ),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const game = {
  gameId: "film",
  currentVersion: "1",
  title: "Catalog title",
  subtitle: "Catalog subtitle",
  coverUrl: "https://example.com/old.png",
  updatedAt: "2026-10-01T00:00:00Z",
} as ExperienceGameSummary;
const listing = {
  gameId: "film",
  title: "Published title",
  description: "Published description",
  coverUrl: null,
  trailerUrl: null,
  screenshots: [],
  developer: "Studio",
  tags: ["Adventure"],
};
let root: Root, host: HTMLDivElement;
const render = () => act(async () => root.render(<FilmStore game={game} close={h.close} />));
const click = async (label: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.generation = 1;
  h.status = "authenticated";
  h.listing.mockResolvedValue(listing);
  h.latest.mockResolvedValue({ chapterId: "two" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("shows published metadata without restoring a withheld cover, and continues explicitly", async () => {
  await render();
  expect(host.textContent).toContain("Published description");
  expect(host.textContent).not.toContain("Catalog subtitle");
  expect(host.querySelector("img")).toBeNull();
  expect(h.play).not.toHaveBeenCalled();
  await click("games.store.continuePlaying");
  expect(h.play).toHaveBeenCalledWith(
    expect.anything(),
    { ...game, title: listing.title, coverUrl: undefined },
    undefined
  );
  expect(h.close).toHaveBeenCalledOnce();
});
it("uses catalogue fallback only for null introduction and skips guest saves", async () => {
  h.status = "anonymous";
  h.listing.mockResolvedValue(null);
  await render();
  expect(host.textContent).toContain("Catalog subtitle");
  expect(host.querySelector("img")?.src).toBe(game.coverUrl);
  expect(h.latest).not.toHaveBeenCalled();
  await click("games.store.playNow");
  expect(h.play).toHaveBeenCalledOnce();
});
it("keeps failed listing and save reads visible with independent retries", async () => {
  h.listing.mockRejectedValueOnce(Error("Listing offline"));
  h.latest.mockRejectedValueOnce(Error("Save offline"));
  await render();
  expect(host.textContent).toContain("Listing offline");
  expect(host.textContent).toContain("Save offline");
  expect(host.textContent).not.toContain("Catalog subtitle");
  await click("common.retry");
  expect(host.textContent).toContain("Published description");
  expect(host.textContent).toContain("Save offline");
  await click("common.retry");
  expect(host.textContent).toContain("games.store.continuePlaying");
});
it("does not navigate on failed restart and retries only on explicit action", async () => {
  h.restart.mockRejectedValueOnce(Error("Save changed"));
  h.restart.mockResolvedValueOnce("first");
  await render();
  await click("games.store.restartFromBeginning");
  expect(host.textContent).toContain("Save changed");
  expect(h.play).not.toHaveBeenCalled();
  await click("games.store.restartFromBeginning");
  expect(h.play).toHaveBeenCalledWith(
    expect.anything(),
    { ...game, title: listing.title, coverUrl: undefined },
    { chapterId: "first" }
  );
});
it("blocks duplicate restart and ignores completion after background retirement", async () => {
  let resolve!: (v: string) => void;
  h.restart.mockReturnValue(
    new Promise<string>((r) => {
      resolve = r;
    })
  );
  await render();
  await click("games.store.restartFromBeginning");
  await click("games.store.restartFromBeginning");
  expect(h.restart).toHaveBeenCalledOnce();
  await click("common.close");
  expect(h.close).not.toHaveBeenCalled();
  h.active = false;
  await render();
  await act(async () => resolve("first"));
  expect(h.play).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
});
it("remounts account scoped progress instead of reusing another account's latest save", async () => {
  let resolve!: (v: unknown) => void;
  h.latest.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  await render();
  h.generation = 2;
  h.latest.mockResolvedValue(null);
  await render();
  await act(async () => resolve({ chapterId: "other" }));
  expect(host.textContent).toContain("games.store.playNow");
  expect(host.textContent).not.toContain("games.store.continuePlaying");
});
