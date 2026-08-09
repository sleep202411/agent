import "server-only";

import {
  TextGameBossActionSchema,
  TextGameDetailSchema,
  TextGameIdSchema,
  TextGameSummaryListSchema,
  textGameStatusAfterBossAction,
  type TextGameBossAction,
  type TextGameDetail,
  type TextGameSummary,
} from "@repo/shared/text-game";

const BOSS_TEXT_GAME_PATH = "/api/boss/text-game";

// Java currently exposes the boss endpoints without authentication. Keep this
// module server-only: browser calls terminate at admin-ui Route Handlers, which
// enforce the admin session and `ip.moderate` before reaching these functions.

type JavaEnvelope = {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
};

export type AdminTextGameLoadResult<T> = {
  data: T | null;
  error: string | null;
};

export async function loadReviewingTextGames(): Promise<
  AdminTextGameLoadResult<TextGameSummary[]>
> {
  try {
    return { data: await getReviewingTextGames(), error: null };
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

export async function getReviewingTextGames(): Promise<TextGameSummary[]> {
  const data = await requestJavaTextGame(`${BOSS_TEXT_GAME_PATH}/reviewing`);
  const items = TextGameSummaryListSchema.parse(data);
  if (items.some((item) => item.status !== "reviewing")) {
    throw new Error("Java 文游审核队列返回了非审核中作品。");
  }
  return items;
}

export async function getAdminTextGameDetail(gameId: string): Promise<TextGameDetail> {
  const requestedGameId = TextGameIdSchema.parse(gameId);
  const data = await requestJavaTextGame(
    `${BOSS_TEXT_GAME_PATH}/${encodeURIComponent(requestedGameId)}`
  );
  return parseAdminTextGameDetail(data, requestedGameId);
}

export async function transitionAdminTextGame(
  gameId: string,
  input: TextGameBossAction
): Promise<TextGameDetail> {
  const requestedGameId = TextGameIdSchema.parse(gameId);
  const action = TextGameBossActionSchema.parse(input);
  const data = await requestJavaTextGame(
    `${BOSS_TEXT_GAME_PATH}/${encodeURIComponent(requestedGameId)}/status`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    }
  );
  const detail = parseAdminTextGameDetail(data, requestedGameId);
  const expectedStatus = textGameStatusAfterBossAction(action.action);
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
