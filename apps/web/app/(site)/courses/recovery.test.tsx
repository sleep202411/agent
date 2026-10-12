import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Catalog from "./page";
import Detail from "./[id]/course-detail-client";
const s = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), play: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "7" }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "a" } }) }));
vi.mock("./_learning/course-enrollment", () => ({
  CourseEnrollGate: () => null,
  useCourseLearning: () => ({
    isPending: false,
    isSuccess: true,
    isError: false,
    data: { offering: null, enrollment: null },
  }),
  courseRequiresEnrollment: () => false,
  isParticipatingInstructor: () => false,
}));
vi.mock("@/src/services/courses-public", () => ({
  listPublicCourses: s.list,
  getPublicCourse: s.detail,
  getPublicCoursePlayUrl: s.play,
  resolveCourseCoverUrl: (url: string) => url,
  publicCoursePriceCredits: () => null,
  publicCourseCertificateId: () => null,
  publicCourseType: () => 2,
  PUBLIC_COURSE_TYPE: { required: 1, master: 2, skill: 3 },
  matchesPublicCoursePriceRange: () => true,
  getAssignedCourseCertificate: async () => null,
}));
vi.mock("@/components/layout/plaza-hero", () => ({ PlazaHero: () => null }));
vi.mock("./_components/PublicCourseList", () => ({
  PublicCourseList: ({ courses }: { courses: { title: string }[] }) => (
    <div>{courses.map((c) => c.title).join(", ")}</div>
  ),
}));
vi.mock("./_components/PublicCourseDetailPanel", () => ({
  PublicCourseDetailPanel: () => <div>Lesson list</div>,
}));
vi.mock("./_components/CourseVideoPlayer", () => ({
  CourseVideoPlayer: ({ videoUrl }: { videoUrl: string }) => <div data-player>{videoUrl}</div>,
}));
let root: Root;
let node: HTMLDivElement;
let client: QueryClient;
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });
}
async function render(element: React.ReactNode) {
  await act(async () =>
    root.render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
  );
  await settle();
}
async function retry() {
  const button = Array.from(node.querySelectorAll("button")).find((b) => b.textContent === "retry");
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  await settle();
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.list.mockReset();
  s.detail.mockReset();
  s.play.mockReset();
  s.detail.mockResolvedValue({
    id: 7,
    title: "Course",
    videos: [{ id: 12, title: "Lesson", sortOrder: 0 }],
    instructors: [],
  });
  s.play.mockResolvedValue("https://fixture.invalid/video.mp4");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});
it("retries a failed catalog request and replaces the error with courses", async () => {
  s.list
    .mockRejectedValueOnce(new Error("Catalog unavailable"))
    .mockResolvedValue([{ id: 7, title: "Film course", instructors: [] }]);
  await render(<Catalog />);
  expect(node.textContent).toContain("Catalog unavailable");
  await retry();
  expect(node.textContent).toContain("Film course");
  expect(node.textContent).not.toContain("Catalog unavailable");
});
it("retries a failed course detail request", async () => {
  s.detail.mockRejectedValueOnce(new Error("Course unavailable"));
  await render(<Detail />);
  expect(node.textContent).toContain("Course unavailable");
  await retry();
  expect(node.textContent).toContain("Lesson list");
  expect(s.detail).toHaveBeenCalledTimes(2);
});
it("retries the selected lesson link without reloading the course", async () => {
  s.play.mockRejectedValueOnce(new Error("Playback unavailable"));
  await render(<Detail />);
  await settle();
  expect(node.textContent).toContain("Playback unavailable");
  expect(node.querySelector("[data-player]")).toBeNull();
  await retry();
  expect(node.querySelector("[data-player]")?.textContent).toContain("video.mp4");
  expect(s.detail).toHaveBeenCalledTimes(1);
  expect(s.play).toHaveBeenCalledTimes(2);
  expect(s.play.mock.calls.map((c) => c[0])).toEqual([12, 12]);
});
