import { NextRequest } from "next/server";
import { requestAdminCourseVideoUploadUrl } from "@/lib/admin-courses";
import { contentPermissionResponse } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = await contentPermissionResponse("courses.write");
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => null)) as {
      fileName?: unknown;
      contentType?: unknown;
    } | null;
    const fileName = typeof body?.fileName === "string" ? body.fileName.trim() : "";
    if (!fileName) {
      return Response.json({ error: "缺少 fileName。" }, { status: 400 });
    }
    const contentType =
      typeof body?.contentType === "string" && body.contentType.trim()
        ? body.contentType.trim()
        : "application/octet-stream";
    const data = await requestAdminCourseVideoUploadUrl({ fileName, contentType });
    return Response.json({ code: 200, msg: "success", data });
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : "";
    const msg = message || "文件上传失败";
    return Response.json({ code: 500, error: msg, msg }, { status: 502 });
  }
}
