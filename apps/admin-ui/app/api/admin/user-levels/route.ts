import { NextRequest } from "next/server";
import {
  deleteAdminUserLevelRelation,
  listAdminUserLevelRelations,
  saveAdminUserLevelRelation,
  type AdminUserLevelSaveInput,
} from "@/lib/admin-user-levels";
import { grantsAdminAccess } from "@/lib/admin-capability";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

function parseOptionalPositiveInt(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/** Paginated relation list for client refresh/filters. */
export async function GET(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return Response.json({ code: 401, msg: "未登录" }, { status: 401 });
  if (!grantsAdminAccess(session.user, "user.read")) {
    return Response.json({ code: 403, msg: "无权限" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  try {
    const data = await listAdminUserLevelRelations({
      page: parseOptionalPositiveInt(searchParams.get("page")) ?? 1,
      pageSize: parseOptionalPositiveInt(searchParams.get("pageSize")) ?? 20,
      userId: parseOptionalPositiveInt(searchParams.get("userId")),
      levelId: parseOptionalPositiveInt(searchParams.get("levelId")),
    });
    return Response.json({ code: 200, msg: "success", data });
  } catch (error) {
    return Response.json(
      {
        code: 502,
        msg: error instanceof Error ? error.message : "加载用户认证等级失败。",
      },
      { status: 502 }
    );
  }
}

/** Create or edit a user↔level relation. */
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return Response.json({ code: 401, msg: "未登录" }, { status: 401 });
  if (!grantsAdminAccess(session.user, "user.write")) {
    return Response.json({ code: 403, msg: "无权限" }, { status: 403 });
  }

  try {
    const input = (await request.json()) as AdminUserLevelSaveInput;
    if (!Number.isInteger(input.levelId) || input.levelId <= 0) {
      return Response.json({ code: 400, msg: "levelId 无效" }, { status: 400 });
    }
    if (input.id === undefined && (!Number.isInteger(input.userId) || (input.userId ?? 0) <= 0)) {
      return Response.json({ code: 400, msg: "新增时 userId 必填" }, { status: 400 });
    }
    await saveAdminUserLevelRelation(input);
    return Response.json({ code: 200, msg: "success", data: null });
  } catch (error) {
    return Response.json(
      {
        code: 502,
        msg: error instanceof Error ? error.message : "保存用户认证等级失败。",
      },
      { status: 502 }
    );
  }
}

/** Delete by relation id (`?id=`). */
export async function DELETE(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return Response.json({ code: 401, msg: "未登录" }, { status: 401 });
  if (!grantsAdminAccess(session.user, "user.write")) {
    return Response.json({ code: 403, msg: "无权限" }, { status: 403 });
  }

  const id = parseOptionalPositiveInt(request.nextUrl.searchParams.get("id"));
  if (!id) {
    return Response.json({ code: 400, msg: "id 无效" }, { status: 400 });
  }

  try {
    await deleteAdminUserLevelRelation(id);
    return Response.json({ code: 200, msg: "success", data: null });
  } catch (error) {
    return Response.json(
      {
        code: 502,
        msg: error instanceof Error ? error.message : "删除用户认证等级失败。",
      },
      { status: 502 }
    );
  }
}
