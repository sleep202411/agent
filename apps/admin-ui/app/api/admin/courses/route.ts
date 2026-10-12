import { NextRequest } from "next/server";
import { createAdminCourseDraft, fetchAdminCoursesList } from "@/lib/admin-courses";
import { contentPermissionResponse } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await contentPermissionResponse("courses.read");
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const result = await fetchAdminCoursesList({
    q: sp.get("q") ?? undefined,
    published: sp.get("published") ?? undefined,
    type: sp.get("type") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (result.error || !result.data) {
    return Response.json({ error: result.error ?? "加载课程列表失败。" }, { status: 502 });
  }
  return Response.json(result.data);
}

export async function POST() {
  const denied = await contentPermissionResponse("courses.write");
  if (denied) return denied;
  try {
    const id = await createAdminCourseDraft();
    return Response.json({ id });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "新建课程失败。" },
      { status: 502 }
    );
  }
}
