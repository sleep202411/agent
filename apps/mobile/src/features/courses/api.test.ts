import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { getCourse, getCourseCertificate, getLessonUrl, listCourses } from "./api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/config", () => ({ appEnv: { assets: {} }, resolveAssetUrl: vi.fn() }));
const signal = () => new AbortController().signal;
const course = { id: 7, title: "Film", videos: [{ id: 8, title: "Lesson" }] };
beforeEach(() => vi.resetAllMocks());
it("retains catalogue categories and the Web default for unclassified courses", async () => {
  const types = [1, "3", 2, undefined, null, "unknown", 0, 99];
  vi.mocked(api.get).mockResolvedValueOnce(
    types.map((type, index) => ({ ...course, id: index + 1, type }))
  );
  expect((await listCourses("en-US", signal())).map((item) => item.type)).toEqual([
    1, 3, 2, 2, 2, 2, 2, 2,
  ]);
});
it.each(["en-US", "zh-CN", "zh-HK"])(
  "uses regional Content APIs with locale %s",
  async (locale) => {
    vi.mocked(api.get).mockResolvedValueOnce([course]).mockResolvedValueOnce(course);
    expect(await listCourses(locale, signal())).toHaveLength(1);
    expect((await getCourse("7", locale, signal())).videos[0].id).toBe(8);
    await getLessonUrl(8, locale, signal());
    expect(api.post).toHaveBeenCalledWith(
      "/project/courses/videos/8/play-url",
      expect.objectContaining({ service: "content", params: { locale } })
    );
  }
);
it.each(["", "../7", "0", "7.5", "9007199254740992"])(
  "rejects invalid identifier %s before sending",
  async (id) => {
    await expect(getCourse(id, "en-US", signal())).rejects.toThrow();
    expect(api.get).not.toHaveBeenCalled();
  }
);
it("rejects wrong courses and duplicate lesson identifiers", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ ...course, id: 9 })
    .mockResolvedValueOnce({ ...course, videos: [course.videos[0], course.videos[0]] });
  await expect(getCourse("7", "en-US", signal())).rejects.toThrow(/mismatch/);
  await expect(getCourse("7", "en-US", signal())).rejects.toThrow(/duplicate/);
});
it("validates the actual type-4 mapping and distinguishes unassigned", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ courseId: "7", certificate: { id: 13, type: 4, name: "Editing" } })
    .mockResolvedValueOnce({ courseId: "7", certificate: null });
  expect((await getCourseCertificate("7", signal())).certificate?.id).toBe(13);
  expect((await getCourseCertificate("7", signal())).certificate).toBeNull();
  expect(api.get).toHaveBeenCalledWith(
    "/academy/course-certificates/7",
    expect.objectContaining({ service: "aurora", retry: false })
  );
});
it.each([
  { courseId: "8", certificate: null },
  { courseId: "7", certificate: { id: 13, type: 1, name: "Founder" } },
])("rejects unrelated mappings", async (reply) => {
  vi.mocked(api.get).mockResolvedValueOnce(reply);
  await expect(getCourseCertificate("7", signal())).rejects.toThrow();
});
it("does not send cancelled reads", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(listCourses("en-US", controller.signal)).rejects.toThrow();
  await expect(getLessonUrl(8, "en-US", controller.signal)).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
