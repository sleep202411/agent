import { getAdminUserLevelApplication } from "@/lib/admin-user-level-applications";
import { grantsAdminAccess } from "@/lib/admin-capability";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Application detail. */
export async function GET(_request: Request, context: RouteContext) {
  const session = await getAdminSession();
  if (!session) return Response.json({ code: 401, msg: "未登录" }, { status: 401 });
  if (!grantsAdminAccess(session.user, "user.read")) {
    return Response.json({ code: 403, msg: "无权限" }, { status: 403 });
  }

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) return Response.json({ code: 400, msg: "id 无效" }, { status: 400 });

  try {
    const data = await getAdminUserLevelApplication(id);
    return Response.json({ code: 200, msg: "success", data });
  } catch (error) {
    return Response.json(
      {
        code: 502,
        msg: error instanceof Error ? error.message : "加载申请详情失败。",
      },
      { status: 502 }
    );
  }
}
