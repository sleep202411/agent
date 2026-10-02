import { NextRequest } from "next/server";
import { publishAdminCourse } from "@/lib/admin-courses";
import { contentPermissionResponse } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await contentPermissionResponse("courses.write");
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = (await request.json().catch(() => null)) as { published?: unknown } | null;
    if (typeof body?.published !== "boolean") {
      return Response.json({ error: "published 必须为 boolean。" }, { status: 400 });
    }
    await publishAdminCourse(id, body.published);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "更新发布状态失败。" },
      { status: 502 }
    );
  }
}
