import { NextRequest } from "next/server";
import {
  listAdminUserLevelApplications,
  type AdminUserLevelApplicationStatus,
} from "@/lib/admin-user-level-applications";
import { grantsAdminAccess } from "@/lib/admin-capability";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

function parseOptionalPositiveInt(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseOptionalStatus(value: string | null): AdminUserLevelApplicationStatus | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  return undefined;
}

/** Paginated application list. */
export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return Response.json({ code: 401, msg: "未登录" }, { status: 401 });
  if (!grantsAdminAccess(session.user, "user.read")) {
    return Response.json({ code: 403, msg: "无权限" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const statusRaw = searchParams.get("status");
  const status =
    statusRaw === null || statusRaw === "" || statusRaw === "all"
      ? undefined
      : parseOptionalStatus(statusRaw);
  if (statusRaw && statusRaw !== "all" && status === undefined) {
    return Response.json({ code: 400, msg: "status 无效" }, { status: 400 });
  }

  try {
    const data = await listAdminUserLevelApplications({
      page: parseOptionalPositiveInt(searchParams.get("page")) ?? 1,
      pageSize: parseOptionalPositiveInt(searchParams.get("pageSize")) ?? 20,
      status,
      userId: parseOptionalPositiveInt(searchParams.get("userId")),
      levelId: parseOptionalPositiveInt(searchParams.get("levelId")),
    });
    return Response.json({ code: 200, msg: "success", data });
  } catch (error) {
    return Response.json(
      {
        code: 502,
        msg: error instanceof Error ? error.message : "加载认证等级申请失败。",
      },
      { status: 502 }
    );
  }
}
