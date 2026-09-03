import { NextRequest } from "next/server";
import { createAdminCourseDraft, fetchAdminCoursesList } from "@/lib/admin-courses";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const result = await fetchAdminCoursesList({
    q: sp.get("q") ?? undefined,
    published: sp.get("published") ?? undefined,
    page: sp.get("page") ?? undefined,
    pageSize: sp.get("pageSize") ?? undefined,
  });
  if (result.error || !result.data) {
    return Response.json({ error: result.error ?? "加载课程列表失败。" }, { status: 502 });
  }
  return Response.json(result.data);
}

export async function POST() {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
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
