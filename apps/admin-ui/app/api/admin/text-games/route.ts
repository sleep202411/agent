import { getReviewingTextGames } from "@/lib/admin-text-games";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await moderationDeniedResponse();
  if (denied) return denied;

  try {
    return Response.json({ code: 200, msg: "成功", data: await getReviewingTextGames() });
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}

async function moderationDeniedResponse(): Promise<Response | null> {
  const session = await getAdminSession();
  if (!session) return Response.json({ code: 401, msg: "后台登录已失效。" }, { status: 401 });
  if (!session.user.permissions.includes("ip.moderate")) {
    return Response.json({ code: 403, msg: "缺少文游审核权限。" }, { status: 403 });
  }
  return null;
}

function upstreamErrorResponse(error: unknown): Response {
  return Response.json(
    {
      code: 502,
      msg: error instanceof Error ? error.message : "Java 文游审核服务请求失败。",
    },
    { status: 502 }
  );
}
