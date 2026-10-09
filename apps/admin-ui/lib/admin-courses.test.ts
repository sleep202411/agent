import { afterEach, expect, it, vi } from "vitest";
import { fetchAdminCoursesList, uploadAdminCourseCover } from "./admin-courses";
vi.mock("@/lib/java-admin-auth", () => ({ javaAdminAuthHeaders: () => ({}) }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("bounds stalled catalogue requests and returns the failure for retry", async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        })
    )
  );
  const result = fetchAdminCoursesList();
  controller.abort(new Error("Course service timed out"));
  expect(await result).toEqual({ data: null, error: "Course service timed out" });
  expect(timeout).toHaveBeenCalledWith(15_000);
});
it("allows a longer bounded deadline for multipart uploads", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: "cover.png" })))
  );
  await uploadAdminCourseCover(new File(["cover"], "cover.png", { type: "image/png" }));
  expect(timeout).toHaveBeenCalledWith(120_000);
});
