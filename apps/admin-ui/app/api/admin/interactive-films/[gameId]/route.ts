import { NextRequest } from "next/server";
import {
  getAdminInteractiveFilmDetail,
  transitionAdminInteractiveFilm,
} from "@/lib/admin-interactive-films";
import { getAdminSession } from "@/lib/admin-session";
import {
  parseInteractiveFilmAdminAction,
  parseInteractiveFilmGameId,
  type InteractiveFilmAdminAction,
} from "@/lib/interactive-film-admin-contract";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ gameId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const denied = await moderationDeniedResponse();
  if (denied) return denied;
  const gameId = parseGameId(await context.params);
  if (!gameId) return invalidGameIdResponse();
  try {
    const response = Response.json({
      code: 200,
      data: await getAdminInteractiveFilmDetail(gameId),
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const denied = await moderationDeniedResponse();
  if (denied) return denied;

  let action: InteractiveFilmAdminAction;
  try {
    action = parseInteractiveFilmAdminAction(await request.json().catch(() => null));
  } catch {
    return Response.json(
      {
        code: 400,
        msg: "审核动作无效；驳回时必须填写 1-1000 字原因。",
      },
      { status: 400 }
    );
  }

  const gameId = parseGameId(await context.params);
  if (!gameId) return invalidGameIdResponse();
  try {
    return Response.json({
      code: 200,
      msg: "成功",
      data: await transitionAdminInteractiveFilm(gameId, action),
    });
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}

function parseGameId(params: { gameId: string }): string | null {
  try {
    return parseInteractiveFilmGameId(params.gameId);
  } catch {
    return null;
  }
}

function invalidGameIdResponse(): Response {
  return Response.json({ code: 400, msg: "影游作品 ID 无效。" }, { status: 400 });
}

async function moderationDeniedResponse(): Promise<Response | null> {
  const session = await getAdminSession();
  if (!session) return Response.json({ code: 401, msg: "后台登录已失效。" }, { status: 401 });
  if (!session.user.permissions.includes("ip.moderate")) {
    return Response.json({ code: 403, msg: "缺少影游审核权限。" }, { status: 403 });
  }
  return null;
}

function upstreamErrorResponse(error: unknown): Response {
  return Response.json(
    {
      code: 502,
      msg: error instanceof Error ? error.message : "Java 影游审核服务请求失败。",
    },
    { status: 502 }
  );
}
