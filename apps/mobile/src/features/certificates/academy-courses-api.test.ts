import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { academyCourseUrl, fetchCertificateCourses } from "./academy-courses-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/config", () => ({ webBaseUrl: "https://fizzdragon.fizzspace.cn" }));
const reply = {
  certificateId: 13,
  items: [{ courseId: "42", title: "Producer Course" }],
  nextCursor: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockResolvedValue(reply);
});
it("uses the shared regional mapping and passes cancellation", async () => {
  const signal = new AbortController().signal;
  expect(await fetchCertificateCourses(13, "zh-CN", signal)).toEqual(reply);
  expect(api.get).toHaveBeenCalledWith("/academy/certificates/13/courses?locale=zh-CN", {
    service: "aurora",
    signal,
    retry: false,
  });
});
it("opens only the configured regional Web course", () => {
  expect(academyCourseUrl("42", "zh-CN")).toBe("https://fizzdragon.fizzspace.cn/zh-CN/courses/42");
  expect(() => academyCourseUrl("https://evil.test", "en-US")).toThrow();
});
it("rejects unrelated and duplicate mapping responses", async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ ...reply, certificateId: 14 });
  await expect(
    fetchCertificateCourses(13, "en-US", new AbortController().signal)
  ).rejects.toThrow();
  vi.mocked(api.get).mockResolvedValueOnce({ ...reply, items: [reply.items[0], reply.items[0]] });
  await expect(
    fetchCertificateCourses(13, "en-US", new AbortController().signal)
  ).rejects.toThrow();
});
it("rejects repeated cursors and cancelled requests", async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ ...reply, nextCursor: "42" });
  await expect(
    fetchCertificateCourses(13, "en-US", new AbortController().signal, "42")
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(fetchCertificateCourses(13, "en-US", controller.signal)).rejects.toThrow();
});
