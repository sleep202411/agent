import "server-only";

import {
  TextGameAdminActionSchema,
  TextGameAdminListSchema,
  TextGameDetailSchema,
  TextGameIdSchema,
  textGameStatusAfterAdminAction,
  type TextGameAdminAction,
  type TextGameAdminList,
  type TextGameDetail,
  type TextGameStatus,
} from "@repo/shared/text-game";
import { javaAdminAuthHeaders } from "@/lib/java-admin-auth";

const ADMIN_TEXT_GAME_PATH = "/api/admin/text-game";

type JavaEnvelope = {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
};

export type AdminTextGameStatusFilter = "all" | TextGameStatus;

export type AdminTextGameListParams = {
  status?: AdminTextGameStatusFilter;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type AdminTextGameLoadResult<T> = {
  data: T | null;
  error: string | null;
};

export async function loadAdminTextGames(
  params?: AdminTextGameListParams
): Promise<AdminTextGameLoadResult<TextGameAdminList>> {
  try {
    return { data: await getAdminTextGames(params), error: null };
  } catch (error) {
    return { data: null, error: textGameErrorMessage(error) };
  }
}

export async function loadAdminTextGameDetail(
  gameId: string
): Promise<AdminTextGameLoadResult<TextGameDetail>> {
  try {
    return { data: await getAdminTextGameDetail(gameId), error: null };
  } catch (error) {
    return { data: null, error: textGameErrorMessage(error) };
  }
}

export async function getAdminTextGames(
  params: AdminTextGameListParams = {}
): Promise<TextGameAdminList> {
  const query = new URLSearchParams({
    status: params.status ?? "all",
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 20),
  });
  const keyword = params.q?.trim();
  if (keyword) query.set("q", keyword);

  return TextGameAdminListSchema.parse(
    await requestJavaTextGame(`${ADMIN_TEXT_GAME_PATH}/reviewing?${query.toString()}`)
  );
}

export async function getAdminTextGameDetail(gameId: string): Promise<TextGameDetail> {
  const requestedGameId = TextGameIdSchema.parse(gameId);
  const data = await requestJavaTextGame(
    `${ADMIN_TEXT_GAME_PATH}/${encodeURIComponent(requestedGameId)}`
  );
  return parseAdminTextGameDetail(data, requestedGameId);
}

export async function transitionAdminTextGame(
  gameId: string,
  input: TextGameAdminAction
): Promise<TextGameDetail> {
  const requestedGameId = TextGameIdSchema.parse(gameId);
  const action = TextGameAdminActionSchema.parse(input);
  const data = await requestJavaTextGame(
    `${ADMIN_TEXT_GAME_PATH}/${encodeURIComponent(requestedGameId)}/status`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    }
  );
  const detail = parseAdminTextGameDetail(data, requestedGameId);
  const expectedStatus = textGameStatusAfterAdminAction(action.action);
  if (detail.status !== expectedStatus) {
    throw new Error(
      `Java 执行 ${action.action} 后返回状态 ${detail.status}，预期为 ${expectedStatus}。`
    );
  }
  return detail;
}

function parseAdminTextGameDetail(data: unknown, expectedGameId: string): TextGameDetail {
  const detail = TextGameDetailSchema.parse(data);
  if (detail.gameId !== expectedGameId) {
    throw new Error(`Java 返回了作品 ${detail.gameId}，但请求的是 ${expectedGameId}。`);
  }
  return detail;
}

function textGameApiBaseUrl(): string {
  const value = process.env.TEXT_GAME_API_BASE_URL?.trim();
  if (!value) {
    throw new Error("缺少 TEXT_GAME_API_BASE_URL，无法连接 Java 文游审核服务。");
  }
  return value.replace(/\/+$/, "");
}

async function requestJavaTextGame(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${textGameApiBaseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...javaAdminAuthHeaders(),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Java 文游审核服务暂时不可访问。");
  }

  const payload = (await response.json().catch(() => null)) as JavaEnvelope | null;
  if (!response.ok || !payload || payload.code !== 200) {
    throw new Error(
      typeof payload?.msg === "string" && payload.msg.trim()
        ? payload.msg
        : `Java 文游审核请求失败：HTTP ${response.status}`
    );
  }
  return payload.data;
}

function textGameErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Java 文游审核服务请求失败。";
}
