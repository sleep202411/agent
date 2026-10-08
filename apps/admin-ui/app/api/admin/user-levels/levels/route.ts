import { grantsAdminAccess } from "@/lib/admin-capability";
import { listAdminUserLevelDefinitions } from "@/lib/admin-user-levels";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

/** Level catalogue for create/edit selects and filter. */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return Response.json({ code: 401, msg: "未登录" }, { status: 401 });
  // Shared by user-levels UI and course/certificate pickers.
  if (
    !grantsAdminAccess(session.user, "user.read") &&
    !grantsAdminAccess(session.user, "courses.read") &&
    !grantsAdminAccess(session.user, "certificate.read")
  ) {
    return Response.json({ code: 403, msg: "无权限" }, { status: 403 });
  }

  try {
    const data = await listAdminUserLevelDefinitions();
    return Response.json({ code: 200, msg: "success", data });
  } catch (error) {
    return Response.json(
      {
        code: 502,
        msg: error instanceof Error ? error.message : "加载等级定义失败。",
      },
      { status: 502 }
    );
  }
}
