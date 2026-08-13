import { NextRequest } from "next/server";
import type { AdminTextGameStatusFilter } from "@/lib/admin-text-games";
import { getAdminSession } from "@/lib/admin-session";
import { getAdminTextGames } from "@/lib/admin-text-games";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = new Set<AdminTextGameStatusFilter>([
  "all",
  "draft",
  "reviewing",
  "published",
  "offline",
]);

export async function GET(request: NextRequest) {
  const denied = await moderationDeniedResponse();
  if (denied) return denied;

  const params = parseListParams(request.nextUrl.searchParams);
  if (!params) {
    return Response.json({ code: 400, msg: "文游列表筛选或分页参数无效。" }, { status: 400 });
  }

  try {
    return Response.json({ code: 200, msg: "成功", data: await getAdminTextGames(params) });
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}

function parseListParams(searchParams: URLSearchParams) {
  const rawStatus = searchParams.get("status") ?? "all";
  const page = parsePositiveInteger(searchParams.get("page") ?? "1");
  const pageSize = parsePositiveInteger(searchParams.get("pageSize") ?? "20");
  if (!STATUS_FILTERS.has(rawStatus as AdminTextGameStatusFilter) || !page || !pageSize) {
    return null;
  }
  return {
    status: rawStatus as AdminTextGameStatusFilter,
    q: searchParams.get("q")?.trim() || undefined,
    page,
    pageSize,
  };
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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
