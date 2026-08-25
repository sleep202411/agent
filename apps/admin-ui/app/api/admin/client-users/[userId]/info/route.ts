import type { NextRequest } from "next/server";
import { decodeUserId } from "@repo/shared/user-id-codec";
import { updateClientUserInfo } from "@/lib/admin-client-users-java";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

// Edit a C-end user's profile via the Java admin API. Gated on session + user.write.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getAdminSession();
  if (!session) return Response.json({ code: 401, msg: "未登录" }, { status: 401 });
  if (!session.user.permissions.includes("user.write")) {
    return Response.json({ code: 403, msg: "无权限" }, { status: 403 });
  }
  try {
    const { userId } = await params;
    // The UI carries the encoded public id; the Java API wants the real id.
    const id = Number(decodeUserId(userId));
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ code: 400, msg: "无效的用户 ID" }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      nickName?: string;
      contact?: string;
      description?: string;
      other?: string;
    };
    const patch: Record<string, string> = {};
    for (const key of ["nickName", "contact", "description", "other"] as const) {
      const value = body[key]?.trim();
      if (value) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      return Response.json({ code: 400, msg: "没有要更新的字段" }, { status: 400 });
    }
    await updateClientUserInfo(id, patch);
    return Response.json({ code: 200, msg: "success" });
  } catch (error) {
    return Response.json(
      { code: 502, msg: error instanceof Error ? error.message : "更新失败" },
      { status: 502 }
    );
  }
}
