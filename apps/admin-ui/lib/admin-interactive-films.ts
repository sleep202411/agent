import "server-only";

import {
  INTERACTIVE_FILM_STATUSES,
  parseAdminInteractiveFilmDetail,
  parseAdminInteractiveFilmList,
  parseInteractiveFilmAdminAction,
  parseInteractiveFilmGameId,
  type AdminInteractiveFilmDetail,
  type AdminInteractiveFilmList,
  type AdminInteractiveFilmStatusFilter,
  type InteractiveFilmAdminAction,
} from "@/lib/interactive-film-admin-contract";
import { requestJavaStudioAdmin } from "@/lib/java-studio-admin";

const ADMIN_INTERACTIVE_FILM_PATH = "/api/admin/interactive-film";
const STATUS_FILTERS = new Set<string>(["all", ...INTERACTIVE_FILM_STATUSES]);

export type AdminInteractiveFilmListParams = {
  status?: AdminInteractiveFilmStatusFilter;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type AdminInteractiveFilmLoadResult<T> = { data: T | null; error: string | null };

export async function loadAdminInteractiveFilms(
  params?: AdminInteractiveFilmListParams
): Promise<AdminInteractiveFilmLoadResult<AdminInteractiveFilmList>> {
  try {
    return { data: await getAdminInteractiveFilms(params), error: null };
  } catch (error) {
    return { data: null, error: interactiveFilmErrorMessage(error) };
  }
}

export async function loadAdminInteractiveFilmDetail(
  gameId: string
): Promise<AdminInteractiveFilmLoadResult<AdminInteractiveFilmDetail>> {
  try {
    return { data: await getAdminInteractiveFilmDetail(gameId), error: null };
  } catch (error) {
    return { data: null, error: interactiveFilmErrorMessage(error) };
  }
}

export async function getAdminInteractiveFilms(
  params: AdminInteractiveFilmListParams = {}
): Promise<AdminInteractiveFilmList> {
  const status = params.status ?? "all";
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const q = params.q?.trim();
  if (
    !STATUS_FILTERS.has(status) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    (q !== undefined && [...q].length > 240)
  ) {
    throw new Error("影游列表筛选或分页参数无效。");
  }

  const query = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) });
  if (q) query.set("q", q);
  return parseAdminInteractiveFilmList(
    await requestJavaStudioAdmin(`${ADMIN_INTERACTIVE_FILM_PATH}/reviewing?${query.toString()}`)
  );
}

export async function getAdminInteractiveFilmDetail(
  gameId: string
): Promise<AdminInteractiveFilmDetail> {
  const requestedGameId = parseInteractiveFilmGameId(gameId);
  const detail = parseAdminInteractiveFilmDetail(
    await requestJavaStudioAdmin(
      `${ADMIN_INTERACTIVE_FILM_PATH}/${encodeURIComponent(requestedGameId)}`
    )
  );
  if (detail.gameId !== requestedGameId) {
    throw new Error(`Java 返回了作品 ${detail.gameId}，但请求的是 ${requestedGameId}。`);
  }
  return detail;
}

export async function transitionAdminInteractiveFilm(
  gameId: string,
  input: InteractiveFilmAdminAction
): Promise<AdminInteractiveFilmDetail> {
  const requestedGameId = parseInteractiveFilmGameId(gameId);
  const action = parseInteractiveFilmAdminAction(input);
  await requestJavaStudioAdmin(
    `${ADMIN_INTERACTIVE_FILM_PATH}/${encodeURIComponent(requestedGameId)}/status`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    }
  );

  // Java owns moderation state. Re-read it instead of keeping a second local state machine.
  return getAdminInteractiveFilmDetail(requestedGameId);
}

function interactiveFilmErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Java 影游审核服务请求失败。";
}
