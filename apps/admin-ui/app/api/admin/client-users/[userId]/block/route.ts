import type { NextRequest } from "next/server";
import { decodeUserId } from "@repo/shared/user-id-codec";
import { blockClientUser } from "@/lib/admin-client-users-java";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

// Block a C-end user via the Java admin API (X-Admin-Api-Token held server-side).
// Gated on the admin-ui session + user.write permission.
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
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim();
    if (!reason) return Response.json({ code: 400, msg: "请填写屏蔽原因" }, { status: 400 });
    if (reason.length > 512) {
      return Response.json({ code: 400, msg: "屏蔽原因不能超过 512 个字符" }, { status: 400 });
    }
    await blockClientUser(id, reason);
    return Response.json({ code: 200, msg: "success" });
  } catch (error) {
    return Response.json(
      { code: 502, msg: error instanceof Error ? error.message : "屏蔽失败" },
      { status: 502 }
    );
  }
}
