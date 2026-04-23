/**
 * Context loader — pulls real project data from Java so ask_* persona
 * tools can ground their answers in reality instead of hallucinating.
 *
 * Each loader returns **trimmed, formatted strings** ready to embed in
 * a persona prompt. We deliberately don't return raw records: agents
 * don't need ids, timestamps, or internal fields — they need a readable
 * chunk they can reason over.
 */
import { javaRequest, type StoryosContext } from "../../lib/workspace-client";

type Record_ = Record<string, unknown>;

const PAGE_SIZE = 20;

/** Fetch up to N characters in the world, formatted as a readable list. */
export async function loadRoles(
  ctx: StoryosContext,
  opts: { worldId?: string; max?: number } = {}
): Promise<string> {
  const worldId = opts.worldId ?? ctx.worldId;
  if (!worldId) return "";
  const max = opts.max ?? 10;
  try {
    const page = await javaRequest<{ list?: Record_[] }>(ctx, "/api/user/world/list/worldrole", {
      data: { worldId, page: 1, pageSize: PAGE_SIZE },
    });
    const items = (page.list ?? []).slice(0, max);
    if (items.length === 0) return "";
    return items
      .map((r, i) => {
        const name = String(r.name ?? r.title ?? `(角色 ${i + 1})`);
        const desc = String(r.description ?? r.prompt ?? "").trim();
        return desc ? `- ${name}：${desc.slice(0, 180)}` : `- ${name}`;
      })
      .join("\n");
  } catch (err) {
    console.warn("[context-loader] loadRoles failed", err);
    return "";
  }
}

export async function loadScenes(
  ctx: StoryosContext,
  opts: { worldId?: string; max?: number } = {}
): Promise<string> {
  const worldId = opts.worldId ?? ctx.worldId;
  if (!worldId) return "";
  const max = opts.max ?? 10;
  try {
    const page = await javaRequest<{ list?: Record_[] }>(ctx, "/api/user/world/list/worldscene", {
      data: { worldId, page: 1, pageSize: PAGE_SIZE },
    });
    const items = (page.list ?? []).slice(0, max);
    if (items.length === 0) return "";
    return items
      .map((s, i) => {
        const name = String(s.name ?? s.title ?? `(场景 ${i + 1})`);
        const desc = String(s.description ?? s.prompt ?? "").trim();
        return desc ? `- ${name}：${desc.slice(0, 180)}` : `- ${name}`;
      })
      .join("\n");
  } catch (err) {
    console.warn("[context-loader] loadScenes failed", err);
    return "";
  }
}

export async function loadProps(
  ctx: StoryosContext,
  opts: { worldId?: string; max?: number } = {}
): Promise<string> {
  const worldId = opts.worldId ?? ctx.worldId;
  if (!worldId) return "";
  const max = opts.max ?? 10;
  try {
    const page = await javaRequest<{ list?: Record_[] }>(ctx, "/api/user/world/list/worldprop", {
      data: { worldId, page: 1, pageSize: PAGE_SIZE },
    });
    const items = (page.list ?? []).slice(0, max);
    if (items.length === 0) return "";
    return items
      .map((p, i) => {
        const name = String(p.name ?? p.title ?? `(道具 ${i + 1})`);
        const desc = String(p.description ?? p.prompt ?? "").trim();
        return desc ? `- ${name}：${desc.slice(0, 180)}` : `- ${name}`;
      })
      .join("\n");
  } catch (err) {
    console.warn("[context-loader] loadProps failed", err);
    return "";
  }
}

/** Fetch the full script of one episode (for editing / review contexts). */
export async function loadEpisodeScript(
  ctx: StoryosContext,
  episodeId: string,
  opts: { maxChars?: number } = {}
): Promise<string> {
  const maxChars = opts.maxChars ?? 8000;
  try {
    const resp = await javaRequest<{ content?: string } | null>(
      ctx,
      "/api/user/project/scripts/episode/detail",
      { data: { episodeId } }
    );
    const content = String(resp?.content ?? "").trim();
    if (!content) return "";
    return content.length > maxChars ? content.slice(0, maxChars) + "\n[…已截断]" : content;
  } catch (err) {
    console.warn("[context-loader] loadEpisodeScript failed", err);
    return "";
  }
}

/** Fetch brief episode metadata (titles, order) for a project. */
export async function loadEpisodes(
  ctx: StoryosContext,
  opts: { max?: number } = {}
): Promise<string> {
  const max = opts.max ?? 40;
  try {
    const page = await javaRequest<{ list?: Record_[] }>(ctx, "/api/user/world/list/episode", {
      data: { projectId: ctx.projectId, page: 1, pageSize: PAGE_SIZE },
    });
    const items = (page.list ?? []).slice(0, max);
    if (items.length === 0) return "";
    return items
      .map((ep, i) => {
        const title = String(ep.title ?? ep.name ?? `第 ${i + 1} 集`);
        const sort = ep.sort ?? i + 1;
        const brief = String(ep.synopsis ?? ep.description ?? "").trim();
        return brief
          ? `- 第 ${sort} 集「${title}」：${brief.slice(0, 120)}`
          : `- 第 ${sort} 集「${title}」`;
      })
      .join("\n");
  } catch (err) {
    console.warn("[context-loader] loadEpisodes failed", err);
    return "";
  }
}

/**
 * Fetch an episode's storyboard — shot list with id + scene + description
 * preview. So storyboarder can answer "how many shots already?" /
 * "what's the last one about?" without hallucinating a zero. Each row
 * includes shotId so supervisor can use it when composing update_*
 * tool calls.
 */
export async function loadStoryboard(
  ctx: StoryosContext,
  episodeId: string,
  opts: { max?: number; maxCharsPerRow?: number } = {}
): Promise<string> {
  const max = opts.max ?? 50;
  const maxCharsPerRow = opts.maxCharsPerRow ?? 80;
  type ShotValue = { presetColumnKey?: string; value?: string };
  type Shot = { shotId?: string | number; shotValues?: ShotValue[] };
  try {
    const resp = await javaRequest<{ list?: Shot[] }>(ctx, "/api/user/shot/queryPage", {
      data: {
        storyBoardId: episodeId,
        page: 1,
        pageSize: 999,
        shotIds: [],
        presetColumnKeys: [],
      },
    });
    const shots = (resp?.list ?? []).slice(0, max);
    if (shots.length === 0) return "";
    return shots
      .map((shot, i) => {
        const values = shot.shotValues ?? [];
        const get = (key: string) =>
          String(values.find((v) => v.presetColumnKey === key)?.value ?? "").trim();
        const shotNo = get("shot_no") || String(i + 1);
        const scene = get("scene");
        const desc = get("description");
        const id = shot.shotId != null ? String(shot.shotId) : "?";
        const preview = desc ? `：${desc.slice(0, maxCharsPerRow)}` : "";
        const sceneTag = scene ? `【${scene}】` : "";
        return `- 第 ${shotNo} 镜 (id ${id})${sceneTag}${preview}`;
      })
      .join("\n");
  } catch (err) {
    console.warn("[context-loader] loadStoryboard failed", err);
    return "";
  }
}

/** Compose project-level summary — lightweight, safe to inject into prompts. */
export async function loadProjectSummary(ctx: StoryosContext): Promise<string> {
  try {
    const detail = await javaRequest<Record_>(ctx, `/api/user/project/detail/${ctx.projectId}`);
    const lines: string[] = [];
    if (detail.name) lines.push(`项目：${detail.name}`);
    if (detail.description) lines.push(`简介：${String(detail.description).slice(0, 200)}`);
    if (detail.genreTag) lines.push(`类型：${detail.genreTag}`);
    if (detail.toneTag) lines.push(`基调：${detail.toneTag}`);
    return lines.join("\n");
  } catch (err) {
    console.warn("[context-loader] loadProjectSummary failed", err);
    return "";
  }
}
