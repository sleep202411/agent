/**
 * Workspace API proxy — forwards requests to the Java backend with auth cookies.
 * Adapted from apps/server AssistantWorkspaceService.
 */

type WorkspaceApiBody<T = unknown> = {
  success?: boolean;
  code?: number | string;
  data?: T;
  msg?: string;
  message?: string;
};

type WorkspaceRecord = Record<string, unknown>;
type WorkspaceAssetType = "character" | "scene" | "prop";

type WorkspacePaginated<T = WorkspaceRecord> = {
  list?: T[];
  total?: number;
  page?: number;
  pageSize?: number;
};

export type WorkspaceContext = {
  projectId: string;
  worldId?: string;
  episodeId?: string;
  activeTab?: string;
  activePanel?: string;
  locale?: string;
};

// ─── Internal helpers ───────────────────────────────────

function getBaseUrl() {
  const url = process.env.WORKSPACE_API_URL;
  if (!url) throw new Error("WORKSPACE_API_URL is not configured");
  return url.replace(/\/$/, "");
}

function toStringId(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

function toDisplayName(record: WorkspaceRecord) {
  const candidate = record.name ?? record.title ?? record.columnName ?? record.presetColumnKey;
  return typeof candidate === "string" ? candidate : "";
}

function dedupeStrings(values: string[]) {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function buildHeaders(incomingHeaders: Headers) {
  const acceptLanguage = incomingHeaders.get("accept-language") || "zh-CN";
  const cookie = incomingHeaders.get("cookie");

  return {
    "Content-Type": "application/json",
    "accept-language": acceptLanguage,
    ...(cookie ? { cookie } : {}),
  };
}

async function request<T>(
  incomingHeaders: Headers,
  path: string,
  options?: {
    method?: "GET" | "POST";
    data?: unknown;
    timeoutMs?: number;
  }
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${getBaseUrl()}${path}`;
  const method = options?.method ?? "POST";

  try {
    const response = await fetch(url, {
      method,
      headers: buildHeaders(incomingHeaders),
      body: options?.data === undefined ? undefined : JSON.stringify(options.data),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`[WorkspaceAPI] HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      throw new Error(`HTTP ${response.status}`);
    }

    const rawBody: unknown = await response.json();
    const body = rawBody as WorkspaceApiBody<T>;
    const isSuccess = body.success === true || body.code === 200 || body.code === "SUCCESS";
    if (!isSuccess) {
      console.error(`[WorkspaceAPI] 业务失败:`, body.code, body.msg || body.message);
      throw new Error(body.msg || body.message || "workspace 请求失败");
    }

    return (body.data ?? null) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Asset helpers ──────────────────────────────────────

function getWorldAssetRoutes(type: WorkspaceAssetType) {
  const map = {
    character: { list: "/user/world/list/worldrole", search: "/user/world/search/worldrole" },
    scene: { list: "/user/world/list/worldscene", search: "/user/world/search/worldscene" },
    prop: { list: "/user/world/list/worldprop", search: "/user/world/search/worldprop" },
  } as const;
  return map[type];
}

// ─── Public API ─────────────────────────────────────────

export async function getProjectContextSummary(headers: Headers, context: WorkspaceContext) {
  const detail = await request<WorkspaceRecord>(
    headers,
    `/api/user/project/detail/${context.projectId}`
  );
  const worldId = context.worldId || toStringId(detail.worldId) || toStringId(detail.world_id);
  const episodeId = context.episodeId || null;

  const [episodes, characterSummary, sceneSummary, propSummary, storyboardSummary] =
    await Promise.all([
      request<{ list?: WorkspaceRecord[] }>(headers, "/api/user/world/list/episode", {
        data: { productId: context.projectId, page: 1, pageSize: 100 },
      }).catch(() => ({ list: [] })),
      worldId
        ? getWorldAssetSummary(headers, worldId, "character").catch(() => ({
            type: "character" as const,
            total: 0,
            sampleNames: [],
            items: [],
          }))
        : Promise.resolve({ type: "character" as const, total: 0, sampleNames: [], items: [] }),
      worldId
        ? getWorldAssetSummary(headers, worldId, "scene").catch(() => ({
            type: "scene" as const,
            total: 0,
            sampleNames: [],
            items: [],
          }))
        : Promise.resolve({ type: "scene" as const, total: 0, sampleNames: [], items: [] }),
      worldId
        ? getWorldAssetSummary(headers, worldId, "prop").catch(() => ({
            type: "prop" as const,
            total: 0,
            sampleNames: [],
            items: [],
          }))
        : Promise.resolve({ type: "prop" as const, total: 0, sampleNames: [], items: [] }),
      episodeId
        ? getStoryboardSummary(headers, episodeId).catch(() => ({
            episodeId,
            shotCount: 0,
            sampleRows: [],
            columns: [],
            columnNames: [],
          }))
        : Promise.resolve({
            episodeId: null,
            shotCount: 0,
            sampleRows: [],
            columns: [],
            columnNames: [],
          }),
    ]);

  return {
    projectId: context.projectId,
    worldId,
    episodeId,
    detail,
    episodes: episodes.list ?? [],
    characterSummary,
    sceneSummary,
    propSummary,
    storyboardSummary,
    activeTab: context.activeTab ?? null,
    activePanel: context.activePanel ?? null,
  };
}

export async function getProjectSnapshot(headers: Headers, projectId: string) {
  const detail = await request<WorkspaceRecord>(headers, `/api/user/project/detail/${projectId}`);
  const episodes = await request<{ list?: WorkspaceRecord[] }>(
    headers,
    "/api/user/world/list/episode",
    { data: { productId: projectId, page: 1, pageSize: 100 } }
  ).catch(() => ({ list: [] }));

  return { detail, episodes: episodes.list ?? [] };
}

export async function getWorldAssets(headers: Headers, worldId: string) {
  const [characters, scenes, props] = await Promise.all([
    request<{ list?: WorkspaceRecord[] }>(headers, "/api/user/world/list/worldrole", {
      data: { worldId, page: 1, pageSize: 100 },
    }).catch(() => ({ list: [] })),
    request<{ list?: WorkspaceRecord[] }>(headers, "/api/user/world/list/worldscene", {
      data: { worldId, page: 1, pageSize: 100 },
    }).catch(() => ({ list: [] })),
    request<{ list?: WorkspaceRecord[] }>(headers, "/api/user/world/list/worldprop", {
      data: { worldId, page: 1, pageSize: 100 },
    }).catch(() => ({ list: [] })),
  ]);

  return {
    characters: characters.list ?? [],
    scenes: scenes.list ?? [],
    props: props.list ?? [],
  };
}

export async function getWorldAssetPage(
  headers: Headers,
  worldId: string,
  type: WorkspaceAssetType,
  params?: { page?: number; pageSize?: number; name?: string }
) {
  const routes = getWorldAssetRoutes(type);
  const payload = { worldId, page: params?.page ?? 1, pageSize: params?.pageSize ?? 20 };

  if (params?.name?.trim()) {
    return request<WorkspacePaginated>(headers, routes.search, {
      data: { ...payload, name: params.name.trim() },
    });
  }
  return request<WorkspacePaginated>(headers, routes.list, { data: payload });
}

export async function getWorldAssetSummary(
  headers: Headers,
  worldId: string,
  type: WorkspaceAssetType,
  params?: { name?: string; sampleSize?: number }
) {
  const page = await getWorldAssetPage(headers, worldId, type, {
    page: 1,
    pageSize: params?.sampleSize ?? 8,
    name: params?.name,
  });
  const items = page.list ?? [];
  return {
    type,
    total: Number(page.total ?? items.length ?? 0),
    sampleNames: dedupeStrings(items.map((item) => toDisplayName(item))),
    items,
  };
}

export async function aggregateWorldAssets(
  headers: Headers,
  worldId: string,
  type: WorkspaceAssetType,
  params?: { name?: string; maxItems?: number; pageSize?: number }
) {
  const pageSize = Math.min(params?.pageSize ?? 50, 100);
  const maxItems = Math.min(params?.maxItems ?? 120, 200);
  const aggregated: WorkspaceRecord[] = [];
  let page = 1;
  let total = 0;

  while (aggregated.length < maxItems) {
    const result = await getWorldAssetPage(headers, worldId, type, {
      page,
      pageSize,
      name: params?.name,
    });
    const list = result.list ?? [];
    total = Number(result.total ?? total ?? list.length);
    aggregated.push(...list);
    if (list.length < pageSize || aggregated.length >= total) break;
    page += 1;
  }

  const items = aggregated.slice(0, maxItems);
  return {
    type,
    total,
    fetched: items.length,
    sampleNames: dedupeStrings(items.map((item) => toDisplayName(item))).slice(0, 30),
    items,
  };
}

export async function getStoryboardSnapshot(headers: Headers, episodeId: string) {
  const [columns, rows] = await Promise.all([
    request<WorkspaceRecord[]>(headers, "/api/user/shotColumn/list", {
      data: { storyBoardId: episodeId },
    }),
    request<{ list?: WorkspaceRecord[] }>(headers, "/api/user/shot/queryPage", {
      data: {
        storyBoardId: episodeId,
        page: 1,
        pageSize: 200,
        shotIds: [],
        presetColumnKeys: [],
      },
      timeoutMs: 120_000,
    }),
  ]);
  return { columns, rows: rows.list ?? [] };
}

export async function queryStoryboardRows(
  headers: Headers,
  episodeId: string,
  params?: {
    page?: number;
    pageSize?: number;
    shotIds?: string[];
    presetColumnKeys?: string[];
  }
) {
  return request<WorkspacePaginated>(headers, "/api/user/shot/queryPage", {
    data: {
      storyBoardId: episodeId,
      page: params?.page ?? 1,
      pageSize: params?.pageSize ?? 50,
      shotIds: params?.shotIds ?? [],
      presetColumnKeys: params?.presetColumnKeys ?? [],
    },
    timeoutMs: 120_000,
  });
}

export async function getStoryboardSummary(headers: Headers, episodeId: string) {
  const [columns, rows] = await Promise.all([
    request<WorkspaceRecord[]>(headers, "/api/user/shotColumn/list", {
      data: { storyBoardId: episodeId },
    }).catch(() => []),
    queryStoryboardRows(headers, episodeId, { page: 1, pageSize: 5 }).catch(() => ({
      list: [],
      total: 0,
    })),
  ]);

  return {
    episodeId,
    shotCount: Number(rows.total ?? rows.list?.length ?? 0),
    sampleRows: rows.list ?? [],
    columns,
    columnNames: dedupeStrings(columns.map((col) => toDisplayName(col as WorkspaceRecord))),
  };
}

export async function aggregateStoryboardRows(
  headers: Headers,
  episodeId: string,
  params?: {
    presetColumnKeys?: string[];
    shotIds?: string[];
    maxRows?: number;
    pageSize?: number;
  }
) {
  const pageSize = Math.min(params?.pageSize ?? 50, 100);
  const maxRows = Math.min(params?.maxRows ?? 120, 200);
  const aggregated: WorkspaceRecord[] = [];
  let page = 1;
  let total = 0;

  while (aggregated.length < maxRows) {
    const result = await queryStoryboardRows(headers, episodeId, {
      page,
      pageSize,
      shotIds: params?.shotIds,
      presetColumnKeys: params?.presetColumnKeys,
    });
    const list = result.list ?? [];
    total = Number(result.total ?? total ?? list.length);
    aggregated.push(...list);
    if (list.length < pageSize || aggregated.length >= total) break;
    page += 1;
  }

  return {
    episodeId,
    total,
    fetched: aggregated.length > maxRows ? maxRows : aggregated.length,
    rows: aggregated.slice(0, maxRows),
  };
}

// ─── Mutation helpers ───────────────────────────────────

export async function updateProject(headers: Headers, data: Record<string, unknown>) {
  return request<WorkspaceRecord>(headers, "/api/user/world/update/worldproduct", { data });
}

export async function createEpisode(headers: Headers, projectId: string, title: string) {
  return request<string | number>(headers, "/api/user/storyBoard/create", {
    data: { projectId, name: title },
  });
}

export async function updateEpisode(headers: Headers, data: Record<string, unknown>) {
  return request<WorkspaceRecord>(headers, "/api/user/world/update/episode", { data });
}

export async function deleteEpisode(headers: Headers, episodeId: string) {
  return request<WorkspaceRecord>(headers, `/api/user/world/delete/episode?id=${episodeId}`);
}

export async function createCharacter(headers: Headers, data: Record<string, unknown>) {
  return request<WorkspaceRecord>(headers, "/api/user/world/create/worldrole", { data });
}

export async function updateCharacter(headers: Headers, data: Record<string, unknown>) {
  return request<WorkspaceRecord>(headers, "/api/user/world/update/worldrole", { data });
}

export async function deleteCharacter(headers: Headers, id: string) {
  return request<WorkspaceRecord>(headers, `/api/user/world/delete/worldrole?id=${id}`);
}

export async function createScene(headers: Headers, data: Record<string, unknown>) {
  return request<WorkspaceRecord>(headers, "/api/user/world/create/worldscene", { data });
}

export async function updateScene(headers: Headers, data: Record<string, unknown>) {
  return request<WorkspaceRecord>(headers, "/api/user/world/update/worldscene", { data });
}

export async function deleteScene(headers: Headers, id: string) {
  return request<WorkspaceRecord>(headers, `/api/user/world/delete/worldscene?id=${id}`);
}

export async function createProp(headers: Headers, data: Record<string, unknown>) {
  return request<WorkspaceRecord>(headers, "/api/user/world/create/worldprop", { data });
}

export async function updateProp(headers: Headers, data: Record<string, unknown>) {
  return request<WorkspaceRecord>(headers, "/api/user/world/update/worldprop", { data });
}

export async function deleteProp(headers: Headers, id: string) {
  return request<WorkspaceRecord>(headers, `/api/user/world/delete/worldprop?id=${id}`);
}

export async function fillCell(
  headers: Headers,
  data: { shotId: string; shotColumnId: string; value?: string; values?: string[] }
) {
  return request<WorkspaceRecord>(headers, "/api/user/shotValue/input", {
    data: {
      shotId: data.shotId,
      shotColumnId: data.shotColumnId,
      value: data.value ?? "",
      values: data.values,
    },
  });
}

export async function saveStoryboardDraft(
  headers: Headers,
  data: { episodeId: string; headers: string[]; rows: string[][]; autoload?: boolean }
) {
  return request<WorkspaceRecord>(headers, "/api/ai/chat/save/storyboard", {
    data: {
      episodeId: data.episodeId,
      datas: [data.headers, ...data.rows],
      autoload: data.autoload ?? true,
    },
    timeoutMs: 300_000,
  });
}
