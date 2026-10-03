import { NextRequest } from "next/server";
import { uploadAdminCourseVideo } from "@/lib/admin-courses";
import { contentPermissionResponse } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = await contentPermissionResponse("courses.write");
  if (denied) return denied;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return Response.json({ error: "缺少 file 字段。" }, { status: 400 });
    }
    const blob = file as Blob;
    const named =
      typeof File !== "undefined" && blob instanceof File
        ? blob
        : new File([blob], "video.mp4", { type: blob.type || "video/mp4" });
    const path = await uploadAdminCourseVideo(named);
    return Response.json({ path, data: path });
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : "";
    return Response.json({ error: message || "文件上传失败" }, { status: 502 });
  }
}
