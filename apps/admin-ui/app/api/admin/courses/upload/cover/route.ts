import { NextRequest } from "next/server";
import { uploadAdminCourseCover } from "@/lib/admin-courses";
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
        : new File([blob], "cover.jpg", { type: blob.type || "image/jpeg" });
    const path = await uploadAdminCourseCover(named);
    return Response.json({ path, data: path });
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : "";
    return Response.json({ error: message || "文件上传失败" }, { status: 502 });
  }
}
