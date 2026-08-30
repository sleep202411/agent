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
import { requestJavaStudioAdmin } from "@/lib/java-studio-admin";

const ADMIN_TEXT_GAME_PATH = "/api/admin/text-game";

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
    await requestJavaStudioAdmin(`${ADMIN_TEXT_GAME_PATH}/reviewing?${query.toString()}`)
  );
}

export async function getAdminTextGameDetail(gameId: string): Promise<TextGameDetail> {
  const requestedGameId = TextGameIdSchema.parse(gameId);
  const data = await requestJavaStudioAdmin(
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
  const data = await requestJavaStudioAdmin(
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

function textGameErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Java 文游审核服务请求失败。";
}
