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
const StoryboardRow = z.object({
  /** 镜号 — "1" / "2" / …; auto-assigned in collect step so LLM can drift. */
  shot_no: z.string().optional(),
  /** 场景 — prefer a worldscene name so frontend can linkify via <mention>. */
  scene: z.string().min(1),
  /** 画面描述 — human-readable prose; can contain @character / @scene refs. */
  description: z.string().min(1),
  /** 图片提示词 — visual-token string fed to image model. */
  image_prompt: z.string().min(1),
  /** 影片提示词 — video-gen prompt emphasizing motion / expression. */
  video_prompt: z.string().optional().default(""),
  /**
   * 运镜 — camera movement vocab: 固定镜头 / 推镜头 / 拉镜头 / 左移镜头 /
   * 右移镜头 / 左摇镜头 / 右摇镜头 / 升镜头 / 降镜头 / 上摇镜头 / 下摇镜头 /
   * 左旋镜头 / 右旋镜头 / 晃动镜头 / 变焦推进 / 变焦拉远 / 场景镜头
   */
  movement: z.string().min(1),
  /** 对白 / 旁白 — "角色：台词" or "旁白：内容"; empty when silent. */
  dialogue: z.string().optional().default(""),
  /** 景别 — 超特写 / 特写 / 中景 / 全景 / 大全景 / 双人镜头 / 过肩 / 主观 / 插镜. */
  shot_size: z.string().min(1),
  /** 视角 — 平视 / 俯视 / 仰视 / 鸟瞰 / 倾斜 / 航拍 / 背面. */
  perspective: z.string().min(1),
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
  feedback: z.string().optional(),
});

export const StoryboardPhaseOutputSchema = z.object({
  outcome: z.enum(["committed", "rejected", "partial_failure"]),
  committed: z.array(z.object({ episodeId: z.string(), title: z.string(), shotCount: z.number() })),
  failed: z.array(z.object({ episodeId: z.string(), title: z.string(), reason: z.string() })),
  message: z.string(),
});

const StateSchema = z.object({
  generated: z
    .array(
      z.object({
        clientRefId: z.string(),
        episodeId: z.string(),
        title: z.string(),
        rows: z.array(StoryboardRow),
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
    return {
      projectId: inputData.projectId,
      episodes,
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

    const total = inputData.episodes.length;
    const concurrency = Math.min(STORYBOARD_GENERATE_CONCURRENCY, total);

    // Per-index slots preserve input order in the final `generated` array
    // regardless of which worker finishes when.
    type GeneratedEntry = z.infer<typeof StateSchema>["generated"][number];
    const generatedByIndex: Array<GeneratedEntry | null> = new Array(total).fill(null);
    const errorsByIndex: Array<string | null> = new Array(total).fill(null);

    let completedCount = 0;
    let cursor = 0;

    await reportProgress(runId, {
      stepId: "storyboard_phase.generate",
      current: 0,
      total,
      label: `分镜师开始并行出分镜（共 ${total} 集，并发 ${concurrency}）`,
    });

    const runOne = async (i: number) => {
      await throwIfCancelled(runId);
      const ep = inputData.episodes[i];
      try {
        const response = await storyboarder.generate(buildPrompt(ep, dialogLanguage), {
          structuredOutput: {
            schema: z.object({ rows: z.array(StoryboardRow).min(5) }),
            errorStrategy: "warn",
          },
        });
        const rows = (
          (response.object as { rows?: z.infer<typeof StoryboardRow>[] } | undefined)?.rows ?? []
        ).slice(0, 60);

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
        await reportProgress(runId, {
          stepId: "storyboard_phase.generate",
          current: completedCount,
          total,
          label: `已出 ${completedCount}/${total} 集分镜`,
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

function buildPrompt(ep: z.infer<typeof EpisodeScriptRef>, dialogLanguage?: string): string {
  const langLabel = storyboardDialogLanguageLabel(dialogLanguage);
  return [
    `请把以下剧集剧本拆成分镜表，JSON 返回，字段 rows 是镜头数组。`,
    "",
    `集标题：${ep.title}`,
    "剧本：",
    "```",
    ep.scriptContent,
    "```",
    "",
    `**dialogue 的对白/旁白必须用${langLabel}**。description / image_prompt / video_prompt 按当前语境自然语言。`,
    "每行 rows 严格按约定字段填：",
    "- **scene** — 场景名（尽量复用剧本里已出现的场景名，前端会自动 linkify）",
    "- **description** — 画面描述（给人读的一句话，可以出现角色名/场景名）",
    "- **image_prompt** — 单帧图像生成提示词（20-60 字视觉 token，按「场景+主体+构图+表情/动作+景别+光线」顺序、顿号分隔；只写画面元素，**不要**加画风/品质 token [写实 / 电影感 / 高清 等]，下游按项目 stylePainting 自动拼接；也不写剧情/情感）",
    "- **video_prompt** — 视频生成用的**动态**描述（运动 / 表情变化 / 环境变化）",
    `- **shot_size** — 景别，从枚举里选一个：${SHOT_SIZE_OPTIONS}`,
    `- **perspective** — 视角，从枚举里选一个：${PERSPECTIVE_OPTIONS}`,
    `- **movement** — 运镜，从枚举里选一个：${MOVEMENT_OPTIONS}`,
    "- **dialogue** — 对白或旁白，格式 `角色名：台词内容` 或 `旁白：内容`；没有留空",
    "- **duration** — 该镜头秒数，2-8",
    "",
    "镜头数量 15-40 个之间。每个镜头时长 2-8 秒。",
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

    if (!resumeData) {
      await reportProgress(runId, {
        stepId: "storyboard_phase.confirm",
        current: inputData.episodeCount,
        total: inputData.episodeCount,
        label: `${inputData.episodeCount} 集分镜（${inputData.totalShots} 个镜头）已就绪，等待确认`,
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
 * Scene column is single-value: if the raw scene name matches a worldscene
 * roster entry, render as a mention; else return verbatim.
 */
function buildSceneMention(map: MentionMap, sceneName: string): string {
  const entry = map.get(sceneName.toLowerCase().trim());
  if (entry && entry.type === "scene") return buildMentionTag(entry);
  return sceneName;
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

    const committed: z.infer<typeof StoryboardPhaseOutputSchema>["committed"] = [];
    const failed: z.infer<typeof StoryboardPhaseOutputSchema>["failed"] = [];

    let i = 0;
    for (const d of accepts) {
      await throwIfCancelled(runId);
      await reportProgress(runId, {
        stepId: "storyboard_phase.commit",
        current: i,
        total: accepts.length,
        label: `保存分镜：${i + 1}/${accepts.length} — ${d.data.title}`,
      });

      const rows2d = d.data.rows.map((r, idx) => {
        // Map StoryboardRow → snake_case columns Java expects. Auto-assign
        // shot_no from index (LLM may skip or duplicate). Inject mentions
        // into scene / description / image_prompt / video_prompt.
        const shotNo = r.shot_no && r.shot_no.trim() ? r.shot_no : String(idx + 1);
        return [
          shotNo,
          buildSceneMention(mentionMap, r.scene),
          injectMentions(mentionMap, r.description),
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

    await reportProgress(runId, {
      stepId: "storyboard_phase.commit",
      current: committed.length,
      total: accepts.length,
      label: `分镜保存完成：成功 ${committed.length} / 失败 ${failed.length}`,
    });

    return {
      outcome,
      committed,
      failed,
      message:
        outcome === "committed"
          ? `已保存 ${committed.length} 集分镜，主流程结束。`
          : `保存有失败：${failed.length} / ${accepts.length}。`,
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
