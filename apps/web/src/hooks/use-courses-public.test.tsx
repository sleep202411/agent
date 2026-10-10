// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  publicCourseVideoStableKey,
  readPublicCourseProgress,
  recomputePublicCourseProgress,
  usePublicCourseDetail,
  usePublicCourseList,
} from "./use-courses-public";
import { writeStoredEpisodeProgress } from "./use-courses";
const mocks = vi.hoisted(() => ({ viewer: "a", detail: vi.fn(), play: vi.fn(), list: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: mocks.viewer } }) }));
vi.mock("@/src/i18n/i18n", () => ({ useLocale: () => "en-US" }));
vi.mock("@/src/services/courses", () => ({}));
vi.mock("@/src/services/courses-public", () => ({
  getPublicCourse: mocks.detail,
  getPublicCoursePlayUrl: mocks.play,
  listPublicCourses: mocks.list,
  resolveCourseCoverUrl: (s: string) => s || "",
  publicCoursePriceCredits: () => null,
  publicCourseCertificateId: () => null,
  matchesPublicCoursePriceRange: () => true,
  getAssignedCourseCertificate: async () => null,
}));
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let current: ReturnType<typeof usePublicCourseDetail>;
function View({ id }: { id: string }) {
  const result = usePublicCourseDetail(id);
  usePublicCourseList();
  useLayoutEffect(() => {
    current = result;
  });
  return null;
}
async function render(id = "1") {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <View id={id} />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.viewer = "a";
  mocks.detail.mockReset().mockImplementation(async (id: number) => ({
    id,
    title: "Course",
    videos: [1, 2].map((n) => ({ id: id * 10 + n, sortOrder: n, title: "Lesson" })),
  }));
  mocks.play.mockReset().mockImplementation(async (id: number) => `${mocks.viewer}/${id}`);
  mocks.list.mockReset().mockResolvedValue([]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  localStorage.clear();
});
it("keeps recalculated zero progress instead of reviving a removed lesson's progress", () => {
  writeStoredEpisodeProgress(
    11,
    { currentTime: 60, duration: 60 },
    publicCourseVideoStableKey(1, 11)
  );
  // With no aggregate yet, the legacy per-lesson fallback remains available.
  expect(readPublicCourseProgress(1, 1)).toBe(100);

  // The current playlist now contains a different, unwatched lesson.
  expect(recomputePublicCourseProgress(1, [12])).toBe(0);
  expect(readPublicCourseProgress(1, 1)).toBe(0);
});

it("restores the destination course lesson and rejects retained selection callbacks", async () => {
  localStorage.setItem("public-course-episode-v1:2", "22");
  await render();
  await act(async () => current.setCurrentVideo(12));
  const oldSelect = current.setCurrentVideo;
  await render("2");
  expect(current.detail?.currentVideoId).toBe(22);
  await act(async () => current.setCurrentVideo(21));
  await act(async () => oldSelect(12));
  expect(current.detail?.currentVideoId).toBe(21);
});
it("does not reuse another viewer's playback URL", async () => {
  await render();
  await render();
  expect(current.detail?.videoUrl).toBe("a/11");
  mocks.viewer = "b";
  mocks.play.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(current.detail?.videoUrl).toBe("");
  expect(mocks.detail).toHaveBeenCalledTimes(2);
});
it("aborts abandoned detail and catalog reads", async () => {
  mocks.detail.mockImplementation(() => new Promise(() => {}));
  mocks.list.mockImplementation(() => new Promise(() => {}));
  await render();
  const detailSignal = mocks.detail.mock.calls[0][2] as AbortSignal;
  const listSignal = mocks.list.mock.calls[0][1] as AbortSignal;
  mocks.viewer = "b";
  await render();
  expect(detailSignal.aborted).toBe(true);
  expect(listSignal.aborted).toBe(true);
});
it("rejects non-integer route identifiers", async () => {
  await render("1.5");
  expect(mocks.detail).not.toHaveBeenCalled();
  expect(mocks.play).not.toHaveBeenCalled();
});

it("keeps public courses and playback available to guests", async () => {
  mocks.viewer = "";
  await render();
  await render();
  expect(mocks.list).toHaveBeenCalled();
  expect(current.detail?.currentVideoId).toBe(11);
  expect(current.detail?.videoUrl).toBe("/11");
});

it("ignores an episode outside the current course", async () => {
  await render();
  await act(async () => current.setCurrentVideo(12));
  await act(async () => current.setCurrentVideo(99));
  expect(current.detail?.currentVideoId).toBe(12);
});
