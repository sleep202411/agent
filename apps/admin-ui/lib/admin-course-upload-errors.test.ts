import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/java-admin-auth", () => ({ javaAdminAuthHeaders: () => ({}) }));
vi.mock("@/lib/admin-content-permission", () => ({
  contentPermissionResponse: vi.fn().mockResolvedValue(null),
}));
import { POST as uploadCover } from "@/app/api/admin/courses/upload/cover/route";
import { POST as uploadVideo } from "@/app/api/admin/courses/upload/video/route";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEWS_API_BASE_URL", "https://courses.example/content");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

for (const [kind, upload] of [
  ["cover", uploadCover],
  ["video", uploadVideo],
] as const) {
  describe(`${kind} upload error details`, () => {
    async function submit() {
      const form = new FormData();
      form.append("file", new File(["fixture"], "sample.mp4"));
      return upload(
        new NextRequest(`http://localhost/api/admin/courses/upload/${kind}`, {
          method: "POST",
          body: form,
        })
      );
    }
    it.each([200, 413])("preserves the upstream rejection with HTTP %s", async (status) => {
      fetchMock.mockResolvedValueOnce(
        Response.json({ code: 413, msg: "Maximum upload size is 20 MB" }, { status })
      );
      const response = await submit();
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Maximum upload size is 20 MB" });
    });
    it("explains a successful response missing the uploaded path", async () => {
      fetchMock.mockResolvedValueOnce(Response.json({ code: 200, data: {} }));
      expect(await (await submit()).json()).toEqual({ error: "上传成功但未返回文件路径。" });
    });
    it("retains a fallback for a non-JSON upstream failure", async () => {
      fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
      expect(await (await submit()).json()).toEqual({ error: "文件上传失败：503" });
    });
    it("preserves the successful path response", async () => {
      fetchMock.mockResolvedValueOnce(
        Response.json({ code: 200, data: { path: "courses/sample.mp4" } })
      );
      expect(await (await submit()).json()).toEqual({
        path: "courses/sample.mp4",
        data: "courses/sample.mp4",
      });
    });
  });
}
