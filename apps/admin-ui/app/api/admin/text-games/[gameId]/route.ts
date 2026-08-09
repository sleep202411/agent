import { NextRequest } from "next/server";
import { TextGameBossActionSchema, TextGameIdSchema } from "@repo/shared/text-game";
import { getAdminSession } from "@/lib/admin-session";
import { getAdminTextGameDetail, transitionAdminTextGame } from "@/lib/admin-text-games";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ gameId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const denied = await moderationDeniedResponse();
  if (denied) return denied;

  try {
    const gameId = parseGameId(await context.params);
    if (!gameId) return invalidGameIdResponse();
    return Response.json({
      code: 200,
      msg: "成功",
      data: await getAdminTextGameDetail(gameId),
    });
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const denied = await moderationDeniedResponse();
  if (denied) return denied;

  const parsed = TextGameBossActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ code: 400, msg: "审核动作无效；驳回时必须填写原因。" }, { status: 400 });
  }

  try {
    const gameId = parseGameId(await context.params);
    if (!gameId) return invalidGameIdResponse();
    return Response.json({
      code: 200,
      msg: "成功",
      data: await transitionAdminTextGame(gameId, parsed.data),
    });
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}

function parseGameId(params: { gameId: string }): string | null {
  const parsed = TextGameIdSchema.safeParse(params.gameId);
  return parsed.success ? parsed.data : null;
}

function invalidGameIdResponse(): Response {
  return Response.json({ code: 400, msg: "文游作品 ID 无效。" }, { status: 400 });
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
