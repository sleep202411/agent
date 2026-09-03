import { NextRequest } from "next/server";
import { uploadAdminCourseVideo } from "@/lib/admin-courses";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
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
    return Response.json(
      { error: error instanceof Error ? error.message : "上传视频失败。" },
      { status: 502 }
    );
  }
}
