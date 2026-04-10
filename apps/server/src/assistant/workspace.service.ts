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
  totalCount?: number;
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
    if (!cookie) {
      this.logger.warn(
        'No cookie in incoming headers — Java backend will reject as not logged in',
      );
    }
    return {
      'Content-Type': 'application/json',
      'accept-language': acceptLanguage,
      ...(cookie ? { cookie } : {}),
    };
  }

  private async request<T>(
    incoming: HeadersLike,
    path: string,
    options?: {
      method?: 'GET' | 'POST';
      data?: unknown;
      timeoutMs?: number;
      maxRetries?: number;
    },
  ): Promise<T> {
    const url = `${this.getBaseUrl(path)}${path}`;
    const method = options?.method ?? 'POST';
    const maxRetries = options?.maxRetries ?? 0;
    const timeoutMs = options?.timeoutMs ?? 60_000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const startTime = Date.now();
        const response = await fetch(url, {
          method,
          headers: this.buildHeaders(incoming),
          body:
            options?.data === undefined
              ? undefined
              : JSON.stringify(options.data),
          signal: controller.signal,
        });
        const elapsed = Date.now() - startTime;

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          this.logger.error(
            `[request] HTTP ${response.status} ${method} ${path} (${elapsed}ms): ${errorText.slice(0, 300)}`,
          );
          if (attempt < maxRetries && response.status >= 500) {
            this.logger.warn(
              `[request] Retrying ${method} ${path} (attempt ${attempt + 1}/${maxRetries})`,
            );
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          throw new Error(
            errorText.includes('Not logged')
              ? 'Not logged in!'
              : `HTTP ${response.status} on ${method} ${path}: ${errorText.slice(0, 500)}`,
          );
        }

        const body = (await response.json()) as WorkspaceApiBody<T>;
        const isSuccess =
          body.success === true || body.code === 200 || body.code === 'SUCCESS';
        if (!isSuccess) {
          const msg = body.msg || body.message || 'workspace 请求失败';
          this.logger.error(
            `[request] FAIL ${method} ${path} (${elapsed}ms) → code=${body.code} msg="${msg}"`,
          );
          throw new Error(msg);
        }

        this.logger.log(`[request] OK ${method} ${path} (${elapsed}ms)`);
        return (body.data ?? null) as T;
      } catch (error) {
        if (
          attempt < maxRetries &&
          error instanceof Error &&
          (error.name === 'AbortError' || error.message.includes('fetch'))
        ) {
          this.logger.warn(
            `[request] ${error.message}, retrying ${method} ${path} (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`[request] Max retries exceeded for ${method} ${path}`);
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
      ).catch((err) => {
        this.logger.warn(
          `[context] /api/user/world/list/episode failed: ${err.message}`,
        );
        return { list: [] };
      }),
      worldId
        ? this.getWorldAssetSummary(headers, worldId, 'character').catch(
            (err) => {
              this.logger.warn(
                `[context] character summary failed: ${err.message}`,
              );
              return {
                type: 'character' as const,
                total: 0,
                sampleNames: [],
                items: [],
              };
            },
          )
        : Promise.resolve({
            type: 'character' as const,
            total: 0,
            sampleNames: [],
            items: [],
          }),
      worldId
        ? this.getWorldAssetSummary(headers, worldId, 'scene').catch((err) => {
            this.logger.warn(`[context] scene summary failed: ${err.message}`);
            return {
              type: 'scene' as const,
              total: 0,
              sampleNames: [],
              items: [],
            };
          })
        : Promise.resolve({
            type: 'scene' as const,
            total: 0,
            sampleNames: [],
            items: [],
          }),
      worldId
        ? this.getWorldAssetSummary(headers, worldId, 'prop').catch((err) => {
            this.logger.warn(`[context] prop summary failed: ${err.message}`);
            return {
              type: 'prop' as const,
              total: 0,
              sampleNames: [],
              items: [],
            };
          })
        : Promise.resolve({
            type: 'prop' as const,
            total: 0,
            sampleNames: [],
            items: [],
          }),
      episodeId
        ? this.getStoryboardSummary(headers, episodeId).catch((err) => {
            this.logger.warn(
              `[context] storyboard summary failed: ${err.message}`,
            );
            return {
              episodeId,
              shotCount: 0,
              sampleRows: [],
              columns: [],
              columnNames: [],
            };
          })
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
      total = Number(result.totalCount ?? result.total ?? total ?? list.length);
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
        list: [] as WorkspaceRecord[],
        totalCount: 0,
        total: 0,
      })),
    ]);

    return {
      episodeId,
      shotCount: Number(
        rows.totalCount ?? rows.total ?? rows.list?.length ?? 0,
      ),
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
      total = Number(result.totalCount ?? result.total ?? total ?? list.length);
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

  async getProjectDetail(
    headers: HeadersLike,
    projectId: string,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      headers,
      `/api/user/project/detail/${projectId}`,
    );
  }

  async updateProject(headers: HeadersLike, data: Record<string, unknown>) {
    return this.request<WorkspaceRecord>(
      headers,
      '/api/user/world/update/worldproduct',
      { data },
    );
  }

  async updateWorld(headers: HeadersLike, data: Record<string, unknown>) {
    return this.request<WorkspaceRecord>(
      headers,
      '/api/user/world/update/world',
      { data },
    );
  }

  async getWorldDetail(headers: HeadersLike, worldId: string) {
    return this.request<Record<string, unknown>>(
      headers,
      `/api/user/world/query/world?id=${worldId}`,
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

  async saveEpisodeScript(
    headers: HeadersLike,
    episodeId: string,
    content: string,
  ) {
    this.logger.log(
      `[saveEpisodeScript] episode=${episodeId} content=${content.length} chars`,
    );
    return this.request<WorkspaceRecord>(
      headers,
      '/api/user/project/scripts/episode/createOrUpdate',
      { data: { episodeId, content }, maxRetries: 2 },
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

  /**
   * Batch create assets via the AI chat batch APIs.
   *
   * datas format: [["name", "description", "prompt"], ["角色A", "描述", "prompt"], ...]
   * First row is header, rest are data rows. Header only supports: name, description, prompt.
   */
  /**
   * List all episodes for a project. Returns array of { id, title, ... }.
   */
  async listEpisodes(
    headers: HeadersLike,
    projectId: string,
  ): Promise<Array<{ id: string; title: string }>> {
    const result = await this.request<{
      list?: Array<{ id: unknown; title?: string }>;
    }>(headers, '/api/user/world/list/episode', {
      data: { productId: projectId, page: 1, pageSize: 999 },
    });
    return (result?.list ?? []).map((ep) => ({
      id: String(ep.id),
      title: String(ep.title ?? ''),
    }));
  }

  async batchCreateRoles(
    headers: HeadersLike,
    worldId: string,
    datas: string[][],
  ) {
    // datas[0] is header row ["name", "description"], rest are data rows
    const rows = datas.slice(1);
    this.logger.log(
      `[batchCreateRoles] ${rows.length} roles for world ${worldId} (sequential)`,
    );
    for (const row of rows) {
      try {
        const name = row[0];
        const description = row[1] ?? '';
        const prompt = row[2] ?? description;
        await this.request<WorkspaceRecord>(
          headers,
          '/api/user/world/create/worldrole',
          {
            data: {
              worldId,
              name,
              description,
              prompt,
              roleImgPath: [],
              referenceImgPath: [],
              referenceImgDescription: [],
              model: '',
              voiceId: '',
            },
          },
        );
      } catch (error) {
        this.logger.error(`[batchCreateRoles] Failed "${row[0]}": ${error}`);
      }
    }
  }

  async batchCreateScenes(
    headers: HeadersLike,
    worldId: string,
    datas: string[][],
  ) {
    const rows = datas.slice(1);
    this.logger.log(
      `[batchCreateScenes] ${rows.length} scenes for world ${worldId} (sequential)`,
    );
    for (const row of rows) {
      try {
        await this.request<WorkspaceRecord>(
          headers,
          '/api/user/world/create/worldscene',
          { data: { worldId, name: row[0], description: row[1] ?? '' } },
        );
      } catch (error) {
        this.logger.error(`[batchCreateScenes] Failed "${row[0]}": ${error}`);
      }
    }
  }

  async batchCreateProps(
    headers: HeadersLike,
    worldId: string,
    datas: string[][],
  ) {
    const rows = datas.slice(1);
    this.logger.log(
      `[batchCreateProps] ${rows.length} props for world ${worldId} (sequential)`,
    );
    for (const row of rows) {
      try {
        await this.request<WorkspaceRecord>(
          headers,
          '/api/user/world/create/worldprop',
          { data: { worldId, name: row[0], description: row[1] ?? '' } },
        );
      } catch (error) {
        this.logger.error(`[batchCreateProps] Failed "${row[0]}": ${error}`);
      }
    }
  }

  async batchAddEpisodes(
    headers: HeadersLike,
    projectId: string,
    titles: string[],
  ): Promise<string[]> {
    this.logger.log(
      `[batchAddEpisodes] ${titles.length} episodes for project ${projectId} (sequential)`,
    );
    const ids: string[] = [];
    for (const title of titles) {
      try {
        const createdId = await this.request<string | number>(
          headers,
          '/api/user/storyBoard/create',
          { data: { projectId, name: title }, maxRetries: 2 },
        );
        ids.push(String(createdId));
        this.logger.log(`[batchAddEpisodes] Created "${title}" → ${createdId}`);
      } catch (error) {
        this.logger.error(`[batchAddEpisodes] Failed "${title}": ${error}`);
        ids.push('');
      }
    }
    return ids;
  }

  /**
   * Batch save scripts to multiple episodes at once.
   * episodeIds and contents must be same length and correspond 1:1.
   * Use empty string for episodes without a script.
   */
  async batchSaveScripts(
    headers: HeadersLike,
    projectId: string,
    episodeIds: string[],
    contents: string[],
  ) {
    this.logger.log(
      `[batchSaveScripts] ${episodeIds.length} scripts for project ${projectId}`,
    );
    return this.request<WorkspaceRecord>(
      headers,
      '/api/user/project/scripts/episode/batch/createOrUpdate',
      {
        data: { projectId, episodeIds, contents },
        maxRetries: 2,
        timeoutMs: 120_000,
      },
    );
  }

  /**
   * Move an episode before another episode for sorting.
   * Pass beforeStoryBoardId=null to move to the end.
   */
  async sortEpisode(
    headers: HeadersLike,
    projectId: string,
    storyBoardId: string,
    beforeStoryBoardId: string | null,
  ) {
    this.logger.log(
      `[sortEpisode] move ${storyBoardId} before ${beforeStoryBoardId ?? 'END'} in project ${projectId}`,
    );
    return this.request<WorkspaceRecord>(headers, '/api/user/storyBoard/sort', {
      data: { projectId, storyBoardId, beforeStoryBoardId },
      maxRetries: 1,
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
    this.logger.log(
      `[saveStoryboardDraft] episode=${data.episodeId} rows=${data.rows.length} cols=${data.headers.join(',')}`,
    );
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
