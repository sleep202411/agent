import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import PlayGameScreen from "@/app/play/interactive-film/[gameId]";
import type { ExperiencePublishedPlayerProps } from "./experience-published-player";
const h = vi.hoisted(() => ({
  params: { gameId: "game" } as { gameId: string; chapter?: string },
  router: { setParams: vi.fn() },
  load: vi.fn(),
  t: (key: string) => key,
  props: {} as ExperiencePublishedPlayerProps,
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => h.params,
  useRouter: () => h.router,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: "button",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, bottom: 0, right: 0 }),
}));
vi.mock("@/auth", () => ({ useAuth: () => ({ generation: 1, status: "authenticated" }) }));
vi.mock("@/features/experience-player/lib/play-session-reporter", () => ({
  createPlaySessionReporter: () => ({}),
}));
vi.mock("@/components/themed-text", () => ({ ThemedText: "span" }));
vi.mock("@/components/themed-view", () => ({ ThemedView: "div" }));
vi.mock("@/constants/theme", () => ({ Spacing: { two: 8 } }));
vi.mock("@/data/interactive-film-api", () => ({
  loadPublishedInteractiveFilm: h.load,
  InteractiveFilmLoadError: class extends Error {},
}));
vi.mock("@/lib/api-client", () => ({ ApiRequestError: class extends Error {} }));
vi.mock("@/hooks/use-screen-orientation", () => ({
  usePlayScreenOrientation: () => ({ landscapeReady: true, exiting: false }),
}));
vi.mock("@/hooks/play-orientation", () => ({ PLAY_ROUTE_SCREEN_OPTIONS: {} }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t, useLocale: () => "en-US" }));
vi.mock("@/features/experience-player", () => ({
  ExperienceChapterButton: () => null,
  ExperienceChapterPicker: () => null,
  ExperienceShareButton: () => null,
  ExperienceStartShell: () => null,
  buildExperiencePlayShareUrl: () => "https://example.test/play",
  chapterDisplayTitle: (chapter: { chapterId: string }) => chapter.chapterId,
  findChapter: (chapters: any[], id: string) =>
    chapters.find((chapter) => chapter.chapterId === id),
  nextChapterAfter: () => null,
}));
vi.mock("./experience-published-player", () => ({
  ExperiencePublishedPlayer: (props: ExperiencePublishedPlayerProps) => {
    h.props = props;
    return <span>Player</span>;
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const render = () => act(async () => root.render(<PlayGameScreen />));
beforeEach(() => {
  vi.clearAllMocks();
  h.params = { gameId: "game" };
  root = createRoot(document.createElement("div"));
  h.load.mockImplementation(async (gameId: string, options: { chapterId?: string }) => ({
    game: { gameId, title: "Film" },
    activeChapterId: options.chapterId ?? "one",
    chapters: [{ chapterId: "one" }, { chapterId: "two" }],
    manifest: { gameId, buildId: "build", contentVersion: "release" },
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("keeps implicit entry eligible for latest-save resolution after canonicalizing the first chapter", async () => {
  await render();
  expect(h.router.setParams).toHaveBeenCalledWith({ chapter: "one" });
  expect(h.props.explicitChapter).toBe(false);
  h.params = { gameId: "game", chapter: "one" };
  await render();
  expect(h.props.explicitChapter).toBe(false);
  expect(h.load).toHaveBeenCalledTimes(1);
  await act(async () => h.props.onSavedChapter("two"));
  expect(h.router.setParams).toHaveBeenLastCalledWith({ chapter: "two" });
  h.params = { gameId: "game", chapter: "two" };
  await render();
  expect(h.props.chapterId).toBe("two");
  expect(h.props.explicitChapter).toBe(true);
});
it("preserves an explicitly opened chapter instead of following another latest save", async () => {
  h.params = { gameId: "game", chapter: "two" };
  await render();
  expect(h.props.chapterId).toBe("two");
  expect(h.props.explicitChapter).toBe(true);
});
