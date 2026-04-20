/**
 * storyboard_phase — per-episode storyboard generation.
 *
 * Iterates each episode, calls the storyboarder persona to produce shot
 * rows, writes a draft per episode, one HITL at the end, then commits via
 * the existing Java save endpoint (/api/ai/chat/save/storyboard, one call
 * per episode since that's the Java contract).
 */
import { randomUUID } from "node:crypto";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  deleteAllDrafts,
  listDrafts,
  markDraftCommitted,
  markDraftCommitting,
  markDraftDiscarded,
  markDraftFailed,
  putDraft,
} from "../../lib/drafts";
import { reportProgress, throwIfCancelled } from "../engine";
import { getContext, javaRequest } from "../../lib/workspace-client";
import {
  publishWorkflowCompleted,
  publishWorkflowFailed,
  publishWorkflowProgress,
  publishWorkflowSuspended,
} from "../../lib/workflow-messages";

// ─── Schemas ───────────────────────────────────────────────────────────

/**
 * Storyboard shot row — column names match Java's `worldshot` schema (see
 * legacy `script-agent.tools.ts` at commit 34f71bc). Java's Tiptap editor
 * binds to these exact snake_case keys, so don't rename without coordinating
 * with the backend.
 *
 * Allowed shotSize / perspective / movement vocabulary is enumerated in
 * `buildPrompt()` below — keep those lists in sync with Java's dropdowns.
 */
/**
 * Required fields are the two minimum units a user needs to recognize the
 * shot: `scene` (which set) + `description` (what's happening). Everything
 * else (camera metadata, prompts, dialogue, duration) defaults to
 * sensible values when the LLM drops them — DeepSeek/Qwen drop camera
 * fields on ~10-30% of shots under load, and hard-rejecting the whole
 * row just forces pointless regeneration. User can fill missing slots
 * in the storyboard editor after.
 */
const StoryboardRow = z.object({
  /** 镜号 — "1" / "2" / …; auto-assigned in collect step so LLM can drift. */
  shot_no: z.string().optional(),
  /**
   * 场景 — prefer a worldscene name so frontend can linkify via <mention>.
   * Optional at schema level (not `.min(1)`) because DeepSeek drops this
   * field on tail rows of long structured outputs (~rows 29-32 of a
   * 30-40 row ask). generateStep filters out rows missing scene OR
   * description before committing — a row lacking either is unusable
   * in the editor anyway, so dropping it is lossless.
   */
  scene: z.string().optional(),
  /** 画面描述 — same laziness caveat as `scene`. */
  description: z.string().optional(),
  /** 图片提示词 — visual-token string fed to image model. */
  image_prompt: z.string().optional().default(""),
  /** 影片提示词 — video-gen prompt emphasizing motion / expression. */
  video_prompt: z.string().optional().default(""),
  /**
   * 运镜 — camera movement vocab: 固定镜头 / 推镜头 / 拉镜头 / 左移镜头 /
   * 右移镜头 / 左摇镜头 / 右摇镜头 / 升镜头 / 降镜头 / 上摇镜头 / 下摇镜头 /
   * 左旋镜头 / 右旋镜头 / 晃动镜头 / 变焦推进 / 变焦拉远 / 场景镜头
   */
  movement: z.string().optional().default("固定镜头"),
  /** 对白 / 旁白 — "角色：台词" or "旁白：内容"; empty when silent. */
  dialogue: z.string().optional().default(""),
  /** 景别 — 超特写 / 特写 / 中景 / 全景 / 大全景 / 双人镜头 / 过肩 / 主观 / 插镜. */
  shot_size: z.string().optional().default("中景"),
  /** 视角 — 平视 / 俯视 / 仰视 / 鸟瞰 / 倾斜 / 航拍 / 背面. */
  perspective: z.string().optional().default("平视"),
  /** 时长 — seconds, 2-8. */
  duration: z.number().min(1).max(120).optional(),
});

const EpisodeScriptRef = z.object({
  episodeId: z.string().min(1),
  title: z.string().min(1),
  scriptContent: z.string().min(1),
});

export const StoryboardPhaseInputSchema = z.object({
  projectId: z.string().min(1),
  /** Optional: only storyboard these episode ids (skip others). */
  onlyEpisodeIds: z.array(z.string()).optional(),
  feedback: z.string().optional(),
});

/** Internal — shape the generate step consumes. */
const ResolvedGenerateInputSchema = z.object({
  projectId: z.string(),
  episodes: z.array(EpisodeScriptRef).min(1),
  /**
   * Existing worldscene names the LLM should pick from. Passed into
   * the prompt as a whitelist; the post-save backfill then resolves
   * name → id against Java without creating duplicates. When the
   * project has no scenes yet, this is empty and LLM falls back to
   * free-form scene naming (backfill will create new scenes for
   * each novel name).
   */
  sceneNames: z.array(z.string()).default([]),
  feedback: z.string().optional(),
});

export const StoryboardPhaseOutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "partial_failure"]),
  committed: z.array(z.object({ episodeId: z.string(), title: z.string(), shotCount: z.number() })),
  failed: z.array(z.object({ episodeId: z.string(), title: z.string(), reason: z.string() })),
  message: z.string(),
});

/**
 * Per-episode storyboard accumulated during generateStep. `rows` defaults
 * to `[]` so a partial entry persisted by a previous run (e.g. Mastra
 * saved state after one episode had been added to `generated` but before
 * its rows were populated) still parses cleanly on the next start. An
 * empty `rows` just means "nothing to commit for this episode" — the
 * commit step's summarize already handles that outcome.
 */
const StateSchema = z.object({
  generated: z
    .array(
      z.object({
        clientRefId: z.string(),
        episodeId: z.string(),
        title: z.string(),
        rows: z.array(StoryboardRow).default([]),
      })
    )
    .default([]),
});

const ResumeSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  acceptedClientRefIds: z.array(z.string()).optional(),
});

const SuspendSchema = z.object({
  runId: z.string(),
  episodeCount: z.number(),
  totalShots: z.number(),
  phase: z.literal("storyboard"),
});

// ─── Step 0: resolve inputs — pull committed episodes + scripts ──────

const resolveInputStep = createStep({
  id: "resolve_input",
  inputSchema: StoryboardPhaseInputSchema,
  outputSchema: ResolvedGenerateInputSchema,
  execute: async ({ inputData, requestContext }) => {
    const ctx = getContext(requestContext);

    // 1. List episodes from Java (sorted).
    const listed = await javaRequest<{
      list?: Array<{
        id: string | number;
        title?: string;
        sort?: number;
      }>;
    }>(ctx, "/api/user/world/list/episode", {
      data: { productId: inputData.projectId, page: 1, pageSize: 999 },
    });
    const episodesMeta = (listed.list ?? [])
      .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
      .map((ep) => ({ id: String(ep.id), title: String(ep.title ?? "") }));

    const filter = inputData.onlyEpisodeIds?.length ? new Set(inputData.onlyEpisodeIds) : null;

    const episodes: z.infer<typeof EpisodeScriptRef>[] = [];
    for (const meta of episodesMeta) {
      if (filter && !filter.has(meta.id)) continue;
      // 2. Fetch script content per episode from Java.
      try {
        const scriptResp = await javaRequest<{
          content?: string;
          script?: string;
        }>(ctx, `/api/user/project/scripts/episode/detail/${encodeURIComponent(meta.id)}`);
        const content = (scriptResp.content ?? scriptResp.script ?? "").trim();
        if (!content) continue;
        episodes.push({
          episodeId: meta.id,
          title: meta.title,
          scriptContent: content,
        });
      } catch {
        // Skip episodes missing scripts — caller can retry after script_phase.
      }
    }
    if (episodes.length === 0) {
      throw new Error("storyboard_phase: no episodes with scripts found. Run script_phase first.");
    }

    // Pull existing worldscene names so the storyboarder can pick from
    // them instead of inventing new ones. Soft-failing — empty list is
    // fine, just means backfill will create scenes as it encounters them.
    const worldId = ctx.worldId ?? "";
    let sceneNames: string[] = [];
    if (worldId) {
      try {
        const sceneList = await javaRequest<{ list?: Array<{ name?: string }> }>(
          ctx,
          "/api/user/world/list/worldscene",
          { data: { worldId, page: 1, pageSize: 999 } }
        );
        sceneNames = (sceneList.list ?? [])
          .map((s) => (typeof s.name === "string" ? s.name.trim() : ""))
          .filter((n) => n.length > 0);
      } catch {
        // leave sceneNames empty — LLM falls back to free-form
      }
    }

    return {
      projectId: inputData.projectId,
      episodes,
      sceneNames,
      feedback: inputData.feedback,
    };
  },
});

// ─── Step 1: generate storyboard per episode ──────────────────────────

/**
 * Episodes are storyboarded in parallel because each prompt is
 * self-contained — we only feed `ep.scriptContent` (no cross-episode
 * context), so serial order gives us no consistency benefit. At
 * concurrency=4 a 13-episode run drops from ~12 minutes to ~3 minutes.
 *
 * Concurrency is env-tunable (STORYBOARD_GENERATE_CONCURRENCY); bumping
 * it higher trades wall-clock for DeepSeek RPM pressure. 4 is a safe
 * default that stays well under any account-level limit.
 */
const STORYBOARD_GENERATE_CONCURRENCY = Math.max(
  1,
  Number(process.env.STORYBOARD_GENERATE_CONCURRENCY ?? 4)
);

const generateStep = createStep({
  id: "generate",
  inputSchema: ResolvedGenerateInputSchema,
  outputSchema: z.object({ episodeCount: z.number(), totalShots: z.number() }),
  stateSchema: StateSchema,
  execute: async ({ inputData, setState, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");

    const storyboarder = mastra?.getAgent("storyboarder");
    if (!storyboarder) throw new Error("storyboarder agent not registered");

    // Propagate the project's dialogue language so dialogue/narration in
    // every shot lands in a single language (UI locale can differ).
    const ctx = getContext(requestContext);
    const dialogLanguage = ctx.dialogLanguage;
    // User-picked target shot count (ProjectParamsForm). buildPrompt uses
    // a ±3 window; falls back to 15-40 when the value isn't set. Picking
    // a lower value also sidesteps DeepSeek's tail-laziness (kicks in
    // ~30 rows) since most episodes will come in under the threshold.
    const shotsPerEpisode = ctx.shotsPerEpisode;

    const total = inputData.episodes.length;
    const concurrency = Math.min(STORYBOARD_GENERATE_CONCURRENCY, total);

    // Per-index slots preserve input order in the final `generated` array
    // regardless of which worker finishes when.
    type GeneratedEntry = z.infer<typeof StateSchema>["generated"][number];
    const generatedByIndex: Array<GeneratedEntry | null> = new Array(total).fill(null);
    const errorsByIndex: Array<string | null> = new Array(total).fill(null);

    let completedCount = 0;
    let cursor = 0;

    const startLabel = `分镜师开始并行出分镜（共 ${total} 集，并发 ${concurrency}）`;
    await reportProgress(runId, {
      stepId: "storyboard_phase.generate",
      current: 0,
      total,
      label: startLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "storyboard_phase", "planning", {
      current: 0,
      total,
      label: startLabel,
    });

    const runOne = async (i: number) => {
      await throwIfCancelled(runId);
      const ep = inputData.episodes[i];
      try {
        // errorStrategy: "strict" still bubbles genuinely malformed output
        // (bad JSON, wrong top-level shape). But individual rows with
        // missing scene/description no longer throw — the schema is
        // lenient on those fields (see StoryboardRow doc) and we drop
        // bad rows below. Previously strict mode killed a whole 30-shot
        // episode because DeepSeek's row 31 was missing `description`.
        const response = await storyboarder.generate(
          buildPrompt(ep, inputData.sceneNames, shotsPerEpisode, dialogLanguage),
          {
            structuredOutput: {
              schema: z.object({ rows: z.array(StoryboardRow).min(5) }),
              errorStrategy: "strict",
            },
          }
        );
        const rawRows =
          (response.object as { rows?: z.infer<typeof StoryboardRow>[] } | undefined)?.rows ?? [];

        // Drop rows that can't carry their own weight (missing scene or
        // description) and renumber — DeepSeek's tail-laziness creates
        // gaps like shot_no "1"..."30","32" that would otherwise confuse
        // the commit step's scene backfill. Filtering before .slice(60)
        // doesn't matter since DeepSeek rarely goes past 40.
        const rows = rawRows
          .filter((r) => !!r.scene?.trim() && !!r.description?.trim())
          .slice(0, 60)
          .map((row, idx) => ({
            ...row,
            shot_no: String(idx + 1),
            // Fallback: if LLM left image_prompt empty, seed it with
            // description so the downstream image-gen step has something
            // to dispatch.
            image_prompt: row.image_prompt?.trim() || row.description || "",
          }));

        // Keep a floor — a 2-shot storyboard isn't worth saving, and
        // surfaces genuine LLM failures (wrong schema entirely, refusals)
        // as a retryable workflow_failed instead of a silent empty draft.
        if (rows.length < 5) {
          const dropped = rawRows.length - rows.length;
          throw new Error(
            `storyboarder returned only ${rows.length} usable rows for episode "${ep.title}" (dropped ${dropped} with missing scene/description).`
          );
        }

        const clientRefId = randomUUID();
        await putDraft(runId, "shot", clientRefId, {
          episodeId: ep.episodeId,
          title: ep.title,
          rows,
        });
        generatedByIndex[i] = { clientRefId, episodeId: ep.episodeId, title: ep.title, rows };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        errorsByIndex[i] = reason;
      } finally {
        // Increment under the single-threaded event loop — no races.
        completedCount += 1;
        const label = `已出 ${completedCount}/${total} 集分镜`;
        await reportProgress(runId, {
          stepId: "storyboard_phase.generate",
          current: completedCount,
          total,
          label,
        });
        await publishWorkflowProgress(ctx.projectId, runId, "storyboard_phase", "planning", {
          current: completedCount,
          total,
          label,
        });
      }
    };

    // Cursor-driven worker pool: each worker pulls the next unassigned
    // index until the cursor exhausts the input. Pattern matches the one
    // in lib/batch-writer.ts.
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= total) return;
        await runOne(i);
      }
    });
    await Promise.all(workers);

    // Fail the step if ANY episode failed — current behavior matches the
    // old serial loop (which would throw on first failure). Parallel just
    // means we surface ALL failures for diagnostics, not just the first.
    const failedCount = errorsByIndex.filter((e) => e !== null).length;
    if (failedCount > 0) {
      const firstError = errorsByIndex.find((e): e is string => e !== null) ?? "unknown";
      throw new Error(
        `storyboard generation failed for ${failedCount}/${total} episodes. First error: ${firstError}`
      );
    }

    const generated = generatedByIndex.filter((g): g is GeneratedEntry => g !== null);
    const totalShots = generated.reduce((sum, g) => sum + g.rows.length, 0);

    setState({ generated });
    return { episodeCount: generated.length, totalShots };
  },
});

function storyboardDialogLanguageLabel(code: string | undefined): string {
  switch (code) {
    case "zh-CN":
      return "简体中文";
    case "zh-HK":
      return "繁体中文";
    case "en-US":
      return "English";
    default:
      return code || "简体中文";
  }
}

const SHOT_SIZE_OPTIONS = "超特写 / 特写 / 中景 / 全景 / 大全景 / 双人镜头 / 过肩 / 主观 / 插镜";
const PERSPECTIVE_OPTIONS = "平视 / 俯视 / 仰视 / 鸟瞰 / 倾斜 / 航拍 / 背面";
const MOVEMENT_OPTIONS =
  "固定镜头 / 推镜头 / 拉镜头 / 左移镜头 / 右移镜头 / 左摇镜头 / 右摇镜头 / 升镜头 / 降镜头 / 上摇镜头 / 下摇镜头 / 左旋镜头 / 右旋镜头 / 晃动镜头 / 变焦推进 / 变焦拉远 / 场景镜头";

function buildPrompt(
  ep: z.infer<typeof EpisodeScriptRef>,
  sceneNames: string[],
  shotsPerEpisode: number | undefined,
  dialogLanguage?: string
): string {
  const langLabel = storyboardDialogLanguageLabel(dialogLanguage);
  // Target shot count — respect the user's pick with ±3 wiggle so LLM has
  // room to breathe without blowing past the tail-laziness zone. Falls
  // back to 15-40 when the value wasn't propagated (shouldn't happen
  // post-worker-fix but keeps the prompt sensible).
  const shotRangeLine =
    typeof shotsPerEpisode === "number" && Number.isFinite(shotsPerEpisode)
      ? `镜头数量约 ${shotsPerEpisode} 个（允许 ${Math.max(5, shotsPerEpisode - 3)}-${shotsPerEpisode + 3} 浮动）。每个镜头时长 2-8 秒。`
      : "镜头数量 15-40 个之间。每个镜头时长 2-8 秒。";
  // Whitelist gate — when the project already has worldscenes committed
  // (scene_phase ran), force the LLM to pick a scene from the roster so
  // backfillSceneColumn hits the cache instead of creating duplicate
  // scenes on every shot. Empty roster falls back to free-form naming.
  const sceneBlock =
    sceneNames.length > 0
      ? [
          "",
          "**可用场景（scene 字段必须从下表里原样选一个，不要自创新名）**：",
          ...sceneNames.map((n) => `- ${n}`),
          "",
        ]
      : [];
  const sceneRule =
    sceneNames.length > 0
      ? "- **scene** — 场景名，**必须**从上方「可用场景」列表中原样挑一个；找不到合适的就挑最接近的，不要自创"
      : "- **scene** — 场景名（尽量复用剧本里已出现的场景名，前端会自动 linkify）";
  return [
    `请把以下剧集剧本拆成分镜表，JSON 返回，字段 rows 是镜头数组。`,
    "",
    `集标题：${ep.title}`,
    "剧本：",
    "```",
    ep.scriptContent,
    "```",
    ...sceneBlock,
    `**dialogue 的对白/旁白必须用${langLabel}**。description / image_prompt / video_prompt 按当前语境自然语言。`,
    "每行 rows 严格按约定字段填：",
    sceneRule,
    "- **description** — 画面描述（给人读的一句话，可以出现角色名/场景名）",
    // image_prompt / video_prompt specs aligned with the legacy skill files
    // (apps/server/src/ai/skills/prompt_format_cn.skill.md — the "Pax 版"
    // authoritative format). Previously we had one-line hand-wavy bullets
    // that produced 20-60 char prompts; now forcing structured field cards
    // at 120-220 chars for image, three-part structure for video.
    "- **image_prompt** — **单帧**图像生成提示词，中文字段化卡（多行文本），**120-220 字**。必须按以下字段顺序和格式：",
    "  ```",
    "  画面描述：<主体 + 环境 + 材质细节 + 空间位置关系（前景-中景-后景） + 光影效果 + 可见物理现象；不写角色连续动作链>",
    "  景别：<大远景 / 全景 / 中景 / 近景 / 特写 / 极特写>",
    "  拍摄角度：<俯拍 / 仰拍 / 平视 / 鸟瞰 / 过肩>",
    "  镜头焦距：<14mm 超广角 / 24mm 广角 / 50mm 标准 / 85mm 中长焦>",
    "  构图：<对角线 / 引导线 / 中心 / 三分法>",
    "  光影：<暖光 / 冷光 / 逆光 / 侧光 / 黄金时刻 / 蓝调时刻 / ...>",
    "  画面氛围：<情绪与质感，一句话>",
    "  ```",
    "  Blocking 强制：若出现关键道具/角色/门/桌/光源，必须写明相对位置（左/右/前景/后景/门框内/走廊尽头）。**不写** cinematic / 8K / 写实 / masterpiece 之类英文画风质量词——下游会按项目 stylePainting 自动拼接。",
    "- **video_prompt** — 动态视频提示词，中文，**严格三段式**（A / B / C 三行）：",
    "  ```",
    "  A. 镜头运动：<机位 + 运动 + 推进 / 横移 / 跟拍 / 固定微动 / 焦点锁定>",
    "  B. 画面描述：<持续动作 + 环境反应 + 物理细节，可生成的动态过程>",
    '  C. 声音：<默认 "无人声，无对白，无背景音乐"；允许自然环境音（风/雪/火焰/布料摩擦），不能有人声或配乐>',
    "  ```",
    "  **硬冲突检查**：如果 dialogue 字段为空 / 「-」，video_prompt 的 B 段不可出现「说话 / 喊叫 / 尖叫」，只能写口型开合、喘息、表情动作。",
    `- **shot_size** — 景别，从枚举里选一个：${SHOT_SIZE_OPTIONS}`,
    `- **perspective** — 视角，从枚举里选一个：${PERSPECTIVE_OPTIONS}`,
    `- **movement** — 运镜，从枚举里选一个：${MOVEMENT_OPTIONS}`,
    "- **dialogue** — 对白或旁白，格式 `角色名：台词内容` 或 `旁白：内容`；没有留空",
    "- **duration** — 该镜头秒数，2-8",
    "",
    shotRangeLine,
  ].join("\n");
}

// ─── Step 2: HITL ─────────────────────────────────────────────────────

const waitConfirmationStep = createStep({
  id: "wait_confirmation",
  inputSchema: z.object({ episodeCount: z.number(), totalShots: z.number() }),
  outputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
  }),
  stateSchema: StateSchema,
  resumeSchema: ResumeSchema,
  suspendSchema: SuspendSchema,
  execute: async ({ inputData, resumeData, suspend, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    const ctx = getContext(requestContext);

    if (!resumeData) {
      await reportProgress(runId, {
        stepId: "storyboard_phase.confirm",
        current: inputData.episodeCount,
        total: inputData.episodeCount,
        label: `${inputData.episodeCount} 集分镜（${inputData.totalShots} 个镜头）已就绪，等待确认`,
      });
      const drafts = await listDrafts<{
        episodeId: string;
        title: string;
        rows: z.infer<typeof StoryboardRow>[];
      }>(runId, { entityType: "shot", statuses: ["pending"] });
      await publishWorkflowSuspended(ctx.projectId, runId, "storyboard_phase", {
        draftGroups: [
          {
            entityType: "shot",
            count: drafts.length,
            items: drafts.map((d) => ({
              clientRefId: d.clientRefId,
              data: d.data as unknown as Record<string, unknown>,
            })),
          },
        ],
        totalDraftCount: drafts.length,
      });
      return await suspend({
        runId,
        episodeCount: inputData.episodeCount,
        totalShots: inputData.totalShots,
        phase: "storyboard" as const,
      });
    }
    return resumeData;
  },
});

// ─── Step 3: commit (one call per episode) ───────────────────────────

// ─── Mention linkification (character + scene → Tiptap <mention> tags) ─

type MentionEntry = {
  id: string;
  type: "character" | "scene";
  name: string;
  imgUrl: string;
};

type MentionMap = Map<string, MentionEntry>; // key = name.toLowerCase()

/**
 * Pull the current project's roles + scenes from Java and index them by
 * lowercased name. Used by the save step to replace plain-text mentions
 * with `<mention …>名字</mention>` tags that the Tiptap editor recognises.
 */
async function buildMentionMap(
  ctx: import("../../lib/workspace-client").StoryosContext
): Promise<MentionMap> {
  const worldId = ctx.worldId ?? "";
  const map: MentionMap = new Map();
  if (!worldId) return map;

  type RawRoleOrScene = {
    id?: string | number;
    name?: string;
    roleImgPath?: string[];
    sceneImgPath?: string[];
  };

  try {
    const [roles, scenes] = await Promise.all([
      javaRequest<{ list?: RawRoleOrScene[] }>(ctx, "/api/user/world/list/worldrole", {
        data: { worldId, page: 1, pageSize: 200 },
      }).catch(() => ({ list: [] as RawRoleOrScene[] })),
      javaRequest<{ list?: RawRoleOrScene[] }>(ctx, "/api/user/world/list/worldscene", {
        data: { worldId, page: 1, pageSize: 200 },
      }).catch(() => ({ list: [] as RawRoleOrScene[] })),
    ]);

    for (const r of roles.list ?? []) {
      const name = String(r.name ?? "").trim();
      if (!name || r.id == null) continue;
      const img = Array.isArray(r.roleImgPath) ? (r.roleImgPath[0] ?? "") : "";
      map.set(name.toLowerCase(), {
        id: String(r.id),
        type: "character",
        name,
        imgUrl: img ? String(img) : "",
      });
    }
    for (const s of scenes.list ?? []) {
      const name = String(s.name ?? "").trim();
      if (!name || s.id == null) continue;
      const img = Array.isArray(s.sceneImgPath) ? (s.sceneImgPath[0] ?? "") : "";
      map.set(name.toLowerCase(), {
        id: String(s.id),
        type: "scene",
        name,
        imgUrl: img ? String(img) : "",
      });
    }
  } catch {
    // mentions are nice-to-have; persist saves even if Java is flaky here
  }
  return map;
}

function buildMentionTag(entry: MentionEntry): string {
  const attrs = [`id="${entry.id}"`, `type="${entry.type}"`];
  if (entry.imgUrl) attrs.push(`imgUrl="${entry.imgUrl}"`);
  return `<mention ${attrs.join(" ")}>${entry.name}</mention>`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace every known role/scene name in `text` with a Tiptap <mention>
 * tag. Sort names longest-first so "王五七" beats "王五" beats "王".
 */
function injectMentions(map: MentionMap, text: string): string {
  if (!text) return "";
  const sorted = [...map.values()].sort((a, b) => b.name.length - a.name.length);
  let result = text;
  for (const entry of sorted) {
    const re = new RegExp(escapeRegex(entry.name), "g");
    result = result.replace(re, buildMentionTag(entry));
  }
  return result;
}

/**
 * Resolve a scene name to its Java worldscene id. Mirrors the frontend's
 * `ensureSceneIdByName` in storyboard-save.ts: cache hit → return id; miss
 * → POST `/api/user/world/create/worldscene` and cache the new id.
 *
 * `cache` is keyed by `name.toLowerCase().trim()` and is mutated in place
 * so repeated scene names within a run reuse the same id.
 */
async function resolveSceneId(
  ctx: import("../../lib/workspace-client").StoryosContext,
  sceneName: string,
  cache: Map<string, string>
): Promise<string> {
  const key = sceneName.toLowerCase().trim();
  if (!key) return "";
  const cached = cache.get(key);
  if (cached) return cached;

  const worldId = ctx.worldId ?? "";
  if (!worldId) return "";

  try {
    const created = await javaRequest<{ id?: string | number } | null>(
      ctx,
      "/api/user/world/create/worldscene",
      {
        data: {
          worldId,
          name: sceneName.trim(),
          description: "",
          prompt: "",
        },
      }
    );
    const id = String((created as { id?: string | number } | null)?.id ?? "");
    if (id) cache.set(key, id);
    return id;
  } catch {
    return "";
  }
}

/**
 * Post-save backfill of the scene column.
 *
 * `/api/ai/chat/save/storyboard` creates the shot rows but the scene cell
 * is left holding raw text. Java's UI reads the scene cell as
 * `shotValue.value = worldscene id` with `presetColumnKey: "scene"` +
 * `sceneId/sceneName/worldId` metadata — so the chip can render name +
 * thumbnail. This mirrors the frontend post-save pass in
 * `storyboard-save.ts::saveStoryboardTableWithBackfill`.
 *
 * Soft-failing: the shot rows are already persisted, backfill degrades
 * UX (no linkified chip) but never loses data.
 */
async function backfillSceneColumn(
  ctx: import("../../lib/workspace-client").StoryosContext,
  episodeId: string,
  rows: z.infer<typeof StoryboardRow>[],
  sceneIdCache: Map<string, string>
): Promise<{ ok: number; failed: number; skipped: number }> {
  const worldId = ctx.worldId ?? "";
  if (!worldId) return { ok: 0, failed: 0, skipped: rows.length };

  let sceneColumnId = "";
  try {
    const columns = await javaRequest<
      Array<{ id?: string | number; presetColumnKey?: string; columnType?: string }>
    >(ctx, "/api/user/shotColumn/list", { data: { storyBoardId: episodeId } });
    const sceneColumn = (columns ?? []).find(
      (c) =>
        c.presetColumnKey === "scene" ||
        (typeof c.columnType === "string" && c.columnType.toUpperCase() === "SCENE")
    );
    sceneColumnId = sceneColumn?.id != null ? String(sceneColumn.id) : "";
  } catch {
    return { ok: 0, failed: 0, skipped: rows.length };
  }
  if (!sceneColumnId) return { ok: 0, failed: 0, skipped: rows.length };

  type PersistedShot = {
    shotId?: string | number;
    shotValues?: Array<{ presetColumnKey?: string; value?: string }>;
  };
  let shots: PersistedShot[] = [];
  try {
    const resp = await javaRequest<{ list?: PersistedShot[] }>(ctx, "/api/user/shot/queryPage", {
      data: {
        storyBoardId: episodeId,
        page: 1,
        pageSize: 999,
        shotIds: [],
        presetColumnKeys: [],
      },
    });
    shots = resp?.list ?? [];
  } catch {
    return { ok: 0, failed: 0, skipped: rows.length };
  }

  // Index by shot_no so we match rows to shotIds even if Java returns
  // them out of input order.
  const shotIdByNo = new Map<string, string>();
  for (const shot of shots) {
    const shotNo = String(
      shot.shotValues?.find((v) => v.presetColumnKey === "shot_no")?.value ?? ""
    ).trim();
    if (shotNo && shot.shotId != null) {
      shotIdByNo.set(shotNo, String(shot.shotId));
    }
  }

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    if (!row.scene) {
      skipped += 1;
      continue;
    }
    const shotNo = row.shot_no && row.shot_no.trim() ? row.shot_no.trim() : String(idx + 1);
    const shotId = shotIdByNo.get(shotNo);
    if (!shotId) {
      failed += 1;
      continue;
    }
    try {
      const sceneId = await resolveSceneId(ctx, row.scene, sceneIdCache);
      if (!sceneId) {
        failed += 1;
        continue;
      }
      await javaRequest(ctx, "/api/user/shotValue/input", {
        data: {
          shotId,
          shotColumnId: sceneColumnId,
          value: sceneId,
          presetColumnKey: "scene",
          sceneId,
          sceneName: row.scene,
          worldId,
        },
      });
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok, failed, skipped };
}

/**
 * Column order sent to Java's `/api/ai/chat/save/storyboard` — first entry
 * in the `datas` array. Matches Java's worldshot schema exactly. Order and
 * naming mirror the legacy script-agent.tools.ts save path so Java's Tiptap
 * editor can read every column without field-mapping logic.
 *
 * `style_planting` is per-row (Java uses it for per-shot style override;
 * we inject the project-level stylePainting into every row). Note the
 * historical typo in the column name — stays `style_planting`, not
 * `style_painting`, to match Java's existing schema.
 */
const STORYBOARD_HEADERS = [
  "shot_no",
  "scene",
  "description",
  "image_prompt",
  "video_prompt",
  "style_planting",
  "movement",
  "dialogue",
  "shot_size",
  "perspective",
  "duration",
] as const;

const applyDecisionStep = createStep({
  id: "apply_decision",
  inputSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
    acceptedClientRefIds: z.array(z.string()).optional(),
  }),
  outputSchema: StoryboardPhaseOutputSchema,
  stateSchema: StateSchema,
  execute: async ({ inputData, state, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    await throwIfCancelled(runId);

    const ctx = getContext(requestContext);
    const stylePainting = ctx.stylePainting ?? "";
    const generated = state.generated ?? [];

    if (!inputData.approved) {
      for (const g of generated) await markDraftDiscarded(runId, g.clientRefId);
      await publishWorkflowFailed(ctx.projectId, runId, "storyboard_phase", {
        terminalStatus: "cancelled",
        error: inputData.feedback ? `用户要求修改：${inputData.feedback}` : "用户未通过。",
        retryable: false,
      });
      return {
        outcome: "rejected" as const,
        committed: [],
        failed: [],
        message: inputData.feedback
          ? `分镜阶段未通过。反馈：${inputData.feedback}`
          : "分镜阶段未通过。",
      };
    }

    // Load worldrole + worldscene rosters so we can replace plain names in
    // description / image_prompt / video_prompt with Tiptap <mention> tags —
    // matches the legacy script-agent.tools.ts linkification pass so the
    // frontend renders them as clickable chips with thumbnails.
    const mentionMap = await buildMentionMap(ctx);

    // Scene name → worldscene id cache, shared across all episodes in this
    // run. Pre-seed from the roster so we only hit Java for new names.
    const sceneIdCache = new Map<string, string>();
    for (const [key, entry] of mentionMap.entries()) {
      if (entry.type === "scene" && entry.id) sceneIdCache.set(key, entry.id);
    }

    const accepted = inputData.acceptedClientRefIds
      ? new Set(inputData.acceptedClientRefIds)
      : null;
    const drafts = await listDrafts<{
      episodeId: string;
      title: string;
      rows: z.infer<typeof StoryboardRow>[];
    }>(runId, { entityType: "shot", statuses: ["pending"] });
    const accepts = drafts.filter((d) => !accepted || accepted.has(d.clientRefId));

    for (const it of accepts) await markDraftCommitting(runId, it.clientRefId);

    await publishWorkflowProgress(ctx.projectId, runId, "storyboard_phase", "committing", {
      current: 0,
      total: accepts.length,
      label: `开始保存 ${accepts.length} 集分镜…`,
    });

    const committed: z.infer<typeof StoryboardPhaseOutputSchema>["committed"] = [];
    const failed: z.infer<typeof StoryboardPhaseOutputSchema>["failed"] = [];

    let i = 0;
    for (const d of accepts) {
      await throwIfCancelled(runId);
      const label = `保存分镜：${i + 1}/${accepts.length} — ${d.data.title}`;
      await reportProgress(runId, {
        stepId: "storyboard_phase.commit",
        current: i,
        total: accepts.length,
        label,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "storyboard_phase", "committing", {
        current: i,
        total: accepts.length,
        label,
      });

      const rows2d = d.data.rows.map((r, idx) => {
        // Map StoryboardRow → snake_case columns Java expects. Auto-assign
        // shot_no from index (LLM may skip or duplicate). scene column gets
        // plain name here; backfillSceneColumn overwrites it with the
        // worldscene id + metadata after save. description / image_prompt /
        // video_prompt get mention injection for inline chip rendering.
        const shotNo = r.shot_no && r.shot_no.trim() ? r.shot_no : String(idx + 1);
        // scene / description are `optional` at the schema level (LLM
        // sometimes drops them) but generateStep's filter has already
        // guaranteed both exist here — `?? ""` is just to satisfy TS.
        return [
          shotNo,
          r.scene ?? "",
          injectMentions(mentionMap, r.description ?? ""),
          injectMentions(mentionMap, r.image_prompt),
          injectMentions(mentionMap, r.video_prompt ?? ""),
          stylePainting, // style_planting — project-level style per-row
          r.movement,
          r.dialogue ?? "",
          r.shot_size,
          r.perspective,
          r.duration != null ? String(r.duration) : "",
        ];
      });

      try {
        await javaRequest<unknown>(ctx, "/api/ai/chat/save/storyboard", {
          data: {
            episodeId: d.data.episodeId,
            datas: [STORYBOARD_HEADERS, ...rows2d],
            autoload: true,
          },
          timeoutMs: 300_000,
        });

        // Backfill scene column with worldscene ids. The save/storyboard
        // call above leaves scene cells as plain text; the UI needs
        // `shotValue.value = sceneId` with preset metadata. Soft-failing —
        // shots are already persisted, missing scene links just degrade UX.
        try {
          const sceneBackfill = await backfillSceneColumn(
            ctx,
            d.data.episodeId,
            d.data.rows,
            sceneIdCache
          );
          if (sceneBackfill.failed > 0) {
            console.warn(
              `[storyboard_phase] scene backfill ep ${d.data.episodeId}: ok=${sceneBackfill.ok} failed=${sceneBackfill.failed} skipped=${sceneBackfill.skipped}`
            );
          }
        } catch (err) {
          console.warn(
            `[storyboard_phase] scene backfill error ep ${d.data.episodeId}:`,
            err instanceof Error ? err.message : String(err)
          );
        }

        await markDraftCommitted(runId, d.clientRefId, d.data.episodeId);
        committed.push({
          episodeId: d.data.episodeId,
          title: d.data.title,
          shotCount: d.data.rows.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markDraftFailed(runId, d.clientRefId, message);
        failed.push({
          episodeId: d.data.episodeId,
          title: d.data.title,
          reason: message,
        });
      }
      i += 1;
    }

    const outcome: z.infer<typeof StoryboardPhaseOutputSchema>["outcome"] =
      failed.length === 0 ? "committed" : "partial_failure";

    if (failed.length === 0) await deleteAllDrafts(runId);

    const endLabel = `分镜保存完成：成功 ${committed.length} / 失败 ${failed.length}`;
    await reportProgress(runId, {
      stepId: "storyboard_phase.commit",
      current: committed.length,
      total: accepts.length,
      label: endLabel,
    });
    await publishWorkflowProgress(ctx.projectId, runId, "storyboard_phase", "committing", {
      current: committed.length,
      total: accepts.length,
      label: endLabel,
    });

    const summaryText =
      outcome === "committed"
        ? `已保存 ${committed.length} 集分镜，主流程结束。`
        : `保存有失败：${failed.length} / ${accepts.length}。`;

    // Terminal workflow — no nextStep (storyboard is the end of the chain).
    await publishWorkflowCompleted(ctx.projectId, runId, "storyboard_phase", {
      committed: committed.map((c) => ({ serverId: c.episodeId, title: c.title })),
      failed: failed.map((f) => ({ clientRefId: f.episodeId, reason: f.reason })),
      summary: summaryText,
    });

    return {
      outcome,
      committed,
      failed,
      message: summaryText,
    };
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const storyboardPhaseWorkflow = createWorkflow({
  id: "storyboard_phase",
  description:
    "分镜阶段：每集调分镜师出镜头 → HITL → 批量入库。支持 fromProjectOutline 自动读已入库剧集/剧本。",
  inputSchema: StoryboardPhaseInputSchema,
  outputSchema: StoryboardPhaseOutputSchema,
  stateSchema: StateSchema,
})
  .then(resolveInputStep)
  .then(generateStep)
  .then(waitConfirmationStep)
  .then(applyDecisionStep)
  .commit();

export type StoryboardPhaseOutput = z.infer<typeof StoryboardPhaseOutputSchema>;
