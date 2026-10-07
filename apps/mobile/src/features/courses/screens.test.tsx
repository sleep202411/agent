import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CourseScreen, CoursesScreen } from "./screens";
import { api } from "@/lib/api-client";
import { appTabItems } from "@/components/app-tab-items";
import { lessonProgressKey } from "./lesson-progress";
vi.mock("./course-certificate", () => ({ CourseCertificate: () => <div>Mapped certificate</div> }));
const h = vi.hoisted(() => ({
  locale: "en-US",
  user: null as { id: string } | null,
  active: true,
  push: vi.fn(),
  pause: vi.fn(),
  login: vi.fn(),
  urls: [] as string[],
  status: "readyToPlay",
  saved: new Map<string, string>(),
  players: [] as { currentTime: number }[],
  t: (key: string) => key,
}));
vi.mock("@/auth", () => ({
  useAuthGate: () => ({ isAuthenticated: !!h.user, openLogin: h.login }),
  useAuth: () => ({ user: h.user, status: h.user ? "authenticated" : "anonymous" }),
}));
vi.mock("@/i18n", () => ({ useLocale: () => h.locale, useTranslations: () => h.t }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", assets: { bannerBaseUrl: "https://assets.test" } },
  resolveAssetUrl: (path: string) => path,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/lib/persistent-storage", () => ({
  getStoredString: async (key: string) => h.saved.get(key) ?? null,
  setStoredString: async (key: string, value: string) => {
    h.saved.set(key, value);
  },
}));
vi.mock("expo", () => ({
  useEvent: () => ({
    status: h.status,
    error: h.status === "error" ? { message: "Playback expired" } : undefined,
  }),
}));
vi.mock("expo-video", () => ({
  useVideoPlayer: (url: string) => {
    h.urls.push(url);
    const player = {
      pause: h.pause,
      duration: 100,
      currentTime: 0,
      status: h.status,
      addListener: () => ({ remove: vi.fn() }),
    };
    h.players.push(player);
    return player;
  },
  VideoView: () => <div>video</div>,
}));
type Box = { children?: ReactNode };
vi.mock("react-native", () => ({
  Platform: {
    OS: "web",
    select: (values: Record<string, unknown>) => values.web ?? values.default,
  },
  StyleSheet: { create: (value: unknown) => value },
  View: ({ children }: Box) => <div>{children}</div>,
  ScrollView: ({ children }: Box) => <div>{children}</div>,
  ActivityIndicator: () => <div>loading</div>,
  Pressable: ({ children, onPress }: Box & { onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  TextInput: ({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) => (
    <input value={value} onChange={(e) => onChangeText(e.target.value)} />
  ),
  FlatList: ({
    data,
    ListHeaderComponent,
    ListEmptyComponent,
    renderItem,
  }: {
    data: { id: number }[];
    ListHeaderComponent: ReactNode;
    ListEmptyComponent: ReactNode;
    renderItem: (v: { item: { id: number } }) => ReactNode;
  }) => (
    <div>
      {ListHeaderComponent}
      {data.length
        ? data.map((item) => <div key={item.id}>{renderItem({ item })}</div>)
        : ListEmptyComponent}
    </div>
  ),
}));
vi.mock("@/components/themed-view", () => ({
  ThemedView: ({ children }: Box) => <div>{children}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: Box) => <span>{children}</span>,
}));
vi.mock("@/components/ui", () => ({
  ScreenHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  PosterImage: () => null,
  EmptyState: ({
    title,
    detail,
    action,
  }: {
    title: string;
    detail: string;
    action?: { label: string; onPress: () => void };
  }) => (
    <div>
      {title}
      {detail}
      {action && <button onClick={action.onPress}>{action.label}</button>}
    </div>
  ),
}));
const course = {
  id: 7,
  title: "Film course",
  description: "Editing",
  coverUrl: "",
  instructors: [{ userId: 1, nickName: "Instructor" }],
  videos: [
    { id: 2, sortOrder: 2, title: "Second", coverUrl: "" },
    { id: 1, sortOrder: 1, title: "First", coverUrl: "" },
  ],
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  h.locale = "en-US";
  h.user = null;
  h.active = true;
  h.urls = [];
  h.status = "readyToPlay";
  h.saved.clear();
  h.players = [];
  vi.mocked(api.get).mockResolvedValue(course);
  vi.mocked(api.post).mockResolvedValue("https://media.test/lesson.mp4");
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const detail = () => act(async () => root.render(<CourseScreen id="7" />));
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
it("preserves the existing five tabs including News", () => {
  expect(appTabItems.map((item) => item.name)).toEqual([
    "index",
    "creators",
    "crews",
    "news",
    "mine",
  ]);
  expect(appTabItems[3].href).toBe("/news");
});
it("lets guests browse real courses and navigate to their native detail", async () => {
  vi.mocked(api.get).mockResolvedValue([course]);
  await act(async () => root.render(<CoursesScreen />));
  expect(api.get).toHaveBeenCalledWith(
    "/project/courses",
    expect.objectContaining({ service: "content", params: { locale: "en-US" } })
  );
  expect(host.textContent).toContain("Instructor");
  act(() => button("Film course").click());
  expect(h.push).toHaveBeenCalledWith({ pathname: "/courses/[id]", params: { id: "7" } });
});
it("uses lesson ordering and fetches a fresh playback URL when switching", async () => {
  await detail();
  expect(api.post).toHaveBeenLastCalledWith(
    "/project/courses/videos/1/play-url",
    expect.objectContaining({ params: { locale: "en-US" }, service: "content" })
  );
  await act(async () => button("Second").click());
  expect(api.post).toHaveBeenLastCalledWith(
    "/project/courses/videos/2/play-url",
    expect.anything()
  );
  expect(h.pause).toHaveBeenCalled();
});
it("aborts an obsolete lesson read and ignores its late response", async () => {
  let finish!: (value: string) => void;
  vi.mocked(api.post).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await detail();
  const signal = vi.mocked(api.post).mock.calls[0]![1]!.signal!;
  await act(async () => button("Second").click());
  expect(signal.aborted).toBe(true);
  await act(async () => finish("https://media.test/old.mp4"));
  expect(h.urls).not.toContain("https://media.test/old.mp4");
});
it.each(["account", "locale"])("clears signed playback after changing %s", async (change) => {
  await detail();
  if (change === "account") h.user = { id: "other" };
  else h.locale = "zh-CN";
  const count = vi.mocked(api.post).mock.calls.length;
  await detail();
  expect(api.post).toHaveBeenCalledTimes(count + 1);
  expect(h.pause).toHaveBeenCalled();
  expect(api.get).toHaveBeenLastCalledWith(
    "/project/courses/7",
    expect.objectContaining({ params: { locale: h.locale } })
  );
});
it("stops video when the screen becomes inactive", async () => {
  await detail();
  h.active = false;
  await detail();
  expect(h.pause).toHaveBeenCalled();
  expect(host.textContent).not.toContain("video");
});
it("retries playback errors with a fresh signed URL", async () => {
  await detail();
  h.status = "error";
  await detail();
  expect(host.textContent).toContain("Playback expired");
  h.status = "readyToPlay";
  await act(async () => button("courses.retry").click());
  expect(api.post).toHaveBeenCalledTimes(2);
});
it("shows an API error and lets the user retry without leaving", async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error("Course temporarily unavailable"));
  await detail();
  expect(host.textContent).toContain("Course temporarily unavailable");
  await act(async () => button("courses.retry").click());
  expect(host.textContent).toContain("Film course");
});
it("shows an empty list without inventing course content", async () => {
  vi.mocked(api.get).mockResolvedValue([]);
  await act(async () => root.render(<CoursesScreen />));
  expect(host.textContent).toContain("courses.empty");
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects an invalid course link without requesting the catalog as a detail", async () => {
  await act(async () => root.render(<CourseScreen id="" />));
  expect(host.textContent).toContain("courses.invalid");
  expect(api.get).not.toHaveBeenCalled();
});
it("does not create a native player for an invalid signed URL", async () => {
  vi.mocked(api.post).mockResolvedValueOnce("");
  await detail();
  expect(host.textContent).toContain("courses.playError");
  expect(h.urls).toHaveLength(0);
});
it("restores each lesson independently and saves on background before resuming", async () => {
  h.saved.set(
    lessonProgressKey(null, "global", 7, 1),
    JSON.stringify({ currentTime: 35, duration: 100 })
  );
  h.saved.set(
    lessonProgressKey(null, "global", 7, 2),
    JSON.stringify({ currentTime: 60, duration: 100 })
  );
  await detail();
  expect(h.players.at(-1)?.currentTime).toBe(35);
  await act(async () => button("Second").click());
  expect(h.players.at(-1)?.currentTime).toBe(60);
  h.players.at(-1)!.currentTime = 72;
  h.active = false;
  await detail();
  h.active = true;
  await detail();
  expect(h.players.at(-1)?.currentTime).toBe(72);
});
it("does not restore guest playback into a newly signed-in account", async () => {
  h.saved.set(
    lessonProgressKey(null, "global", 7, 1),
    JSON.stringify({ currentTime: 35, duration: 100 })
  );
  await detail();
  expect(h.players.at(-1)?.currentTime).toBe(35);
  h.user = { id: "alice" };
  await detail();
  expect(h.players.at(-1)?.currentTime).toBe(0);
});
it("offers sign in only after an unauthorized playback response", async () => {
  vi.mocked(api.post).mockRejectedValueOnce(
    Object.assign(new Error("Sign in to watch"), { status: 401 })
  );
  await detail();
  expect(host.textContent).toContain("Sign in to watch");
  act(() => button("courses.signIn").click());
  expect(h.login).toHaveBeenCalledOnce();
  expect(h.urls).toHaveLength(0);
});
it("preserves access denial and never creates a player", async () => {
  vi.mocked(api.post).mockRejectedValueOnce(
    Object.assign(new Error("Course access is required"), { status: 403 })
  );
  await detail();
  expect(host.textContent).toContain("Course access is required");
  expect(host.textContent).not.toContain("courses.signIn");
  expect(h.urls).toHaveLength(0);
});
it("remembers selected lesson on a return visit", async () => {
  await detail();
  await act(async () => button("Second").click());
  await act(async () => root.render(null));
  await detail();
  expect(api.post).toHaveBeenLastCalledWith(
    "/project/courses/videos/2/play-url",
    expect.anything()
  );
});
it("opens the instructor's native creator profile", async () => {
  await detail();
  act(() => button("Instructor").click());
  expect(h.push).toHaveBeenCalledWith({ pathname: "/creator/[id]", params: { id: "1" } });
});
