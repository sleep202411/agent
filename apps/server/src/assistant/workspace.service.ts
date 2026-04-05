import { Injectable, Logger } from '@nestjs/common';

type HeadersLike = Record<string, string | string[] | undefined>;
type WorkspaceRecord = Record<string, unknown>;
type WorkspaceAssetType = 'character' | 'scene' | 'prop';

type WorkspaceApiBody<T = unknown> = {
  success?: boolean;
  code?: number | string;
  data?: T;
  msg?: string;
  message?: string;
};

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

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  // ─── Internal helpers ───────────────────────────────────

  private getBaseUrl(path: string) {
    // /user, /project, /vedio, /personal → Java Content
    // /api, /anon, /studio → Java Studio
    if (/^\/(user|project|vedio|personal)/.test(path)) {
      const url = process.env.JAVA_CONTENT_URL;
      if (!url) throw new Error('JAVA_CONTENT_URL is not configured');
      return url.replace(/\/$/, '');
    }
    const url = process.env.JAVA_STUDIO_URL;
    if (!url) throw new Error('JAVA_STUDIO_URL is not configured');
    return url.replace(/\/$/, '');
  }

  private buildHeaders(incoming: HeadersLike) {
    const acceptLanguage = (incoming['accept-language'] as string) || 'zh-CN';
    const cookie = incoming['cookie'] as string | undefined;
    return {
      'Content-Type': 'application/json',
      'accept-language': acceptLanguage,
      ...(cookie ? { cookie } : {}),
    };
  }

  private async request<T>(
    incoming: HeadersLike,
    path: string,
    options?: { method?: 'GET' | 'POST'; data?: unknown; timeoutMs?: number },
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${this.getBaseUrl(path)}${path}`;
    const method = options?.method ?? 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: this.buildHeaders(incoming),
        body:
          options?.data === undefined
            ? undefined
            : JSON.stringify(options.data),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.logger.error(
          `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
        );
        throw new Error(`HTTP ${response.status}`);
      }

      const body = (await response.json()) as WorkspaceApiBody<T>;
      const isSuccess =
        body.success === true || body.code === 200 || body.code === 'SUCCESS';
      if (!isSuccess) {
        this.logger.error(`业务失败: ${body.code} ${body.msg || body.message}`);
        throw new Error(body.msg || body.message || 'workspace 请求失败');
      }

      return (body.data ?? null) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Asset routes ───────────────────────────────────────

  private getWorldAssetRoutes(type: WorkspaceAssetType) {
    const map = {
      character: {
        list: '/api/user/world/list/worldrole',
        search: '/api/user/world/search/worldrole',
      },
      scene: {
        list: '/api/user/world/list/worldscene',
        search: '/api/user/world/search/worldscene',
      },
      prop: {
        list: '/api/user/world/list/worldprop',
        search: '/api/user/world/search/worldprop',
      },
    } as const;
    return map[type];
  }

  private toStringId(value: unknown) {
    if (typeof value === 'string' || typeof value === 'number')
      return String(value);
    return null;
  }

  private toDisplayName(record: WorkspaceRecord) {
    const candidate =
      record.name ??
      record.title ??
      record.columnName ??
      record.presetColumnKey;
    return typeof candidate === 'string' ? candidate : '';
  }

  private dedupeStrings(values: string[]) {
    return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  }

  // ─── Public: Read ───────────────────────────────────────

  async getProjectContextSummary(
    headers: HeadersLike,
    context: WorkspaceContext,
  ) {
    const detail = await this.request<WorkspaceRecord>(
      headers,
      `/api/user/project/detail/${context.projectId}`,
    );
    const worldId =
      context.worldId ||
      this.toStringId(detail.worldId) ||
      this.toStringId(detail.world_id);
    const episodeId = context.episodeId || null;

    const [
      episodes,
      characterSummary,
      sceneSummary,
      propSummary,
      storyboardSummary,
    ] = await Promise.all([
      this.request<{ list?: WorkspaceRecord[] }>(
        headers,
        '/api/user/world/list/episode',
        {
          data: { productId: context.projectId, page: 1, pageSize: 100 },
        },
      ).catch(() => ({ list: [] })),
      worldId
        ? this.getWorldAssetSummary(headers, worldId, 'character').catch(
            () => ({
              type: 'character' as const,
              total: 0,
              sampleNames: [],
              items: [],
            }),
          )
        : Promise.resolve({
            type: 'character' as const,
            total: 0,
            sampleNames: [],
            items: [],
          }),
      worldId
        ? this.getWorldAssetSummary(headers, worldId, 'scene').catch(() => ({
            type: 'scene' as const,
            total: 0,
            sampleNames: [],
            items: [],
          }))
        : Promise.resolve({
            type: 'scene' as const,
            total: 0,
            sampleNames: [],
            items: [],
          }),
      worldId
        ? this.getWorldAssetSummary(headers, worldId, 'prop').catch(() => ({
            type: 'prop' as const,
            total: 0,
            sampleNames: [],
            items: [],
          }))
        : Promise.resolve({
            type: 'prop' as const,
            total: 0,
            sampleNames: [],
            items: [],
          }),
      episodeId
        ? this.getStoryboardSummary(headers, episodeId).catch(() => ({
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

  async getWorldAssetPage(
    headers: HeadersLike,
    worldId: string,
    type: WorkspaceAssetType,
    params?: { page?: number; pageSize?: number; name?: string },
  ) {
    const routes = this.getWorldAssetRoutes(type);
    const payload = {
      worldId,
      page: params?.page ?? 1,
      pageSize: params?.pageSize ?? 20,
    };

    if (params?.name?.trim()) {
      return this.request<WorkspacePaginated>(headers, routes.search, {
        data: { ...payload, name: params.name.trim() },
      });
    }
    return this.request<WorkspacePaginated>(headers, routes.list, {
      data: payload,
    });
  }

  async getWorldAssetSummary(
    headers: HeadersLike,
    worldId: string,
    type: WorkspaceAssetType,
    params?: { name?: string; sampleSize?: number },
  ) {
    const page = await this.getWorldAssetPage(headers, worldId, type, {
      page: 1,
      pageSize: params?.sampleSize ?? 8,
      name: params?.name,
    });
    const items = page.list ?? [];
    return {
      type,
      total: Number(page.total ?? items.length ?? 0),
      sampleNames: this.dedupeStrings(
        items.map((item) => this.toDisplayName(item)),
      ),
      items,
    };
  }

  async aggregateWorldAssets(
    headers: HeadersLike,
    worldId: string,
    type: WorkspaceAssetType,
    params?: { name?: string; maxItems?: number; pageSize?: number },
  ) {
    const pageSize = Math.min(params?.pageSize ?? 50, 100);
    const maxItems = Math.min(params?.maxItems ?? 120, 200);
    const aggregated: WorkspaceRecord[] = [];
    let page = 1;
    let total = 0;

    while (aggregated.length < maxItems) {
      const result = await this.getWorldAssetPage(headers, worldId, type, {
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
      sampleNames: this.dedupeStrings(
        items.map((item) => this.toDisplayName(item)),
      ).slice(0, 30),
      items,
    };
  }

  async queryStoryboardRows(
    headers: HeadersLike,
    episodeId: string,
    params?: {
      page?: number;
      pageSize?: number;
      shotIds?: string[];
      presetColumnKeys?: string[];
    },
  ) {
    return this.request<WorkspacePaginated>(
      headers,
      '/api/user/shot/queryPage',
      {
        data: {
          storyBoardId: episodeId,
          page: params?.page ?? 1,
          pageSize: params?.pageSize ?? 50,
          shotIds: params?.shotIds ?? [],
          presetColumnKeys: params?.presetColumnKeys ?? [],
        },
        timeoutMs: 120_000,
      },
    );
  }

  async getStoryboardSummary(headers: HeadersLike, episodeId: string) {
    const [columns, rows] = await Promise.all([
      this.request<WorkspaceRecord[]>(headers, '/api/user/shotColumn/list', {
        data: { storyBoardId: episodeId },
      }).catch(() => []),
      this.queryStoryboardRows(headers, episodeId, {
        page: 1,
        pageSize: 5,
      }).catch(() => ({
        list: [],
        total: 0,
      })),
    ]);

    return {
      episodeId,
      shotCount: Number(rows.total ?? rows.list?.length ?? 0),
      sampleRows: rows.list ?? [],
      columns,
      columnNames: this.dedupeStrings(
        columns.map((col) => this.toDisplayName(col as WorkspaceRecord)),
      ),
    };
  }

  async aggregateStoryboardRows(
    headers: HeadersLike,
    episodeId: string,
    params?: {
      presetColumnKeys?: string[];
      shotIds?: string[];
      maxRows?: number;
      pageSize?: number;
    },
  ) {
    const pageSize = Math.min(params?.pageSize ?? 50, 100);
    const maxRows = Math.min(params?.maxRows ?? 120, 200);
    const aggregated: WorkspaceRecord[] = [];
    let page = 1;
    let total = 0;

    while (aggregated.length < maxRows) {
      const result = await this.queryStoryboardRows(headers, episodeId, {
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
      fetched: Math.min(aggregated.length, maxRows),
      rows: aggregated.slice(0, maxRows),
    };
  }

  // ─── Public: Mutations ──────────────────────────────────

  async updateProject(headers: HeadersLike, data: Record<string, unknown>) {
    return this.request<WorkspaceRecord>(
      headers,
      '/api/user/world/update/worldproduct',
      { data },
    );
  }

  async createEpisode(headers: HeadersLike, projectId: string, title: string) {
    return this.request<string | number>(
      headers,
      '/api/user/storyBoard/create',
      {
        data: { projectId, name: title },
      },
    );
  }

  async updateEpisode(headers: HeadersLike, data: Record<string, unknown>) {
    return this.request<WorkspaceRecord>(
      headers,
      '/api/user/world/update/episode',
      { data },
    );
  }

  async deleteEpisode(headers: HeadersLike, episodeId: string) {
    return this.request<WorkspaceRecord>(
      headers,
      `/api/user/world/delete/episode?id=${episodeId}`,
    );
  }

  async createCharacter(headers: HeadersLike, data: Record<string, unknown>) {
    return this.request<WorkspaceRecord>(
      headers,
      '/api/user/world/create/worldrole',
      { data },
    );
  }

  async updateCharacter(headers: HeadersLike, data: Record<string, unknown>) {
    return this.request<WorkspaceRecord>(
      headers,
      '/api/user/world/update/worldrole',
      { data },
    );
  }

  async deleteCharacter(headers: HeadersLike, id: string) {
    return this.request<WorkspaceRecord>(
      headers,
      `/api/user/world/delete/worldrole?id=${id}`,
    );
  }

  async createScene(headers: HeadersLike, data: Record<string, unknown>) {
    return this.request<WorkspaceRecord>(
      headers,
      '/api/user/world/create/worldscene',
      { data },
    );
  }

  async updateScene(headers: HeadersLike, data: Record<string, unknown>) {
    return this.request<WorkspaceRecord>(
      headers,
      '/api/user/world/update/worldscene',
      { data },
    );
  }

  async deleteScene(headers: HeadersLike, id: string) {
    return this.request<WorkspaceRecord>(
      headers,
      `/api/user/world/delete/worldscene?id=${id}`,
    );
  }

  async createProp(headers: HeadersLike, data: Record<string, unknown>) {
    return this.request<WorkspaceRecord>(
      headers,
      '/api/user/world/create/worldprop',
      { data },
    );
  }

  async updateProp(headers: HeadersLike, data: Record<string, unknown>) {
    return this.request<WorkspaceRecord>(
      headers,
      '/api/user/world/update/worldprop',
      { data },
    );
  }

  async deleteProp(headers: HeadersLike, id: string) {
    return this.request<WorkspaceRecord>(
      headers,
      `/api/user/world/delete/worldprop?id=${id}`,
    );
  }

  async fillCell(
    headers: HeadersLike,
    data: {
      shotId: string;
      shotColumnId: string;
      value?: string;
      values?: string[];
    },
  ) {
    return this.request<WorkspaceRecord>(headers, '/api/user/shotValue/input', {
      data: {
        shotId: data.shotId,
        shotColumnId: data.shotColumnId,
        value: data.value ?? '',
        values: data.values,
      },
    });
  }

  async saveStoryboardDraft(
    headers: HeadersLike,
    data: {
      episodeId: string;
      headers: string[];
      rows: string[][];
      autoload?: boolean;
    },
  ) {
    return this.request<WorkspaceRecord>(
      headers,
      '/api/ai/chat/save/storyboard',
      {
        data: {
          episodeId: data.episodeId,
          datas: [data.headers, ...data.rows],
          autoload: data.autoload ?? true,
        },
        timeoutMs: 300_000,
      },
    );
  }
}
