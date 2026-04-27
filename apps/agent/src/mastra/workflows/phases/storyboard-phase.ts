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
import { getContext, javaRequest, type StoryosContext } from "../../lib/workspace-client";
import { resolveSceneIdByName } from "../../lib/storyboard-ids";
import {
  publishWorkflowCompleted,
  publishWorkflowFailed,
  publishWorkflowProgress,
  publishWorkflowSuspended,
} from "../../lib/workflow-messages";
import { publishEntityEvent } from "../../lib/entity-events";
import { PRICES, deductCredits, phaseDeductKey } from "../../lib/billing";
import { contentLanguageInstruction, resolveContentLanguage } from "../../lib/language";
import type { WorkflowCompletedOutput, WorkflowFailedOutput } from "@repo/shared";

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
  /**
   * Shot number — the backend unconditionally overwrites this with
   * `String(idx + 1)` inside generateStep, so we don't care what the LLM
   * returns. `z.coerce.string()` lets DeepSeek / Qwen responses that emit
   * `shot_no` as a bare number (rows.0.shot_no: 1) still pass the schema;
   * otherwise the whole batch (e.g. 11/11 episodes) fails.
   */
  shot_no: z.coerce.string().optional(),
  /**
   * Scene — prefer a worldscene name so the frontend can linkify via
   * `<mention>`. Optional at schema level (not `.min(1)`) because DeepSeek
   * drops this field on tail rows of long structured outputs (~rows 29-32
   * of a 30-40 row ask). generateStep filters out rows missing scene OR
   * description before committing — a row lacking either is unusable in
   * the editor anyway, so dropping it is lossless.
   */
  scene: z.string().optional(),
  /** Description — same laziness caveat as `scene`. */
  description: z.string().optional(),
  /** Image prompt — visual-token string fed to image model. */
  image_prompt: z.string().optional().default(""),
  /** Video prompt — video-gen prompt emphasizing motion / expression. */
  video_prompt: z.string().optional().default(""),
  /**
   * Camera movement — vocab values are stored verbatim in Java's worldshot
   * schema, so the strings themselves are field values, not free text.
   * Allowed: 固定镜头 / 推镜头 / 拉镜头 / 左移镜头 / 右移镜头 / 左摇镜头 /
   * 右摇镜头 / 升镜头 / 降镜头 / 上摇镜头 / 下摇镜头 / 左旋镜头 / 右旋镜头 /
   * 晃动镜头 / 变焦推进 / 变焦拉远 / 场景镜头.
   */
  movement: z.string().optional().default("固定镜头"),
  /** Dialogue / narration — "Character: line" or "Narrator: ..."; empty when silent. */
  dialogue: z.string().optional().default(""),
  /** Shot size (Java enum value): 超特写 / 特写 / 中景 / 全景 / 大全景 / 双人镜头 / 过肩 / 主观 / 插镜. */
  shot_size: z.string().optional().default("中景"),
  /** Perspective (Java enum value): 平视 / 俯视 / 仰视 / 鸟瞰 / 倾斜 / 航拍 / 背面. */
  perspective: z.string().optional().default("平视"),
  /** Duration — seconds, 2-8. coerce covers LLMs returning "5" as string. */
  duration: z.coerce.number().min(1).max(120).optional(),
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
  runId: z.string(),
  draftCount: z.number(),
  message: z.string(),
});

interface StoryboardDraftData {
  episodeId: string;
  title: string;
  rows: z.infer<typeof StoryboardRow>[];
}

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
  execute: async ({ inputData, mastra, requestContext }) => {
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
    type GeneratedEntry = {
      clientRefId: string;
      episodeId: string;
      title: string;
      rows: z.infer<typeof StoryboardRow>[];
    };
    const generatedByIndex: Array<GeneratedEntry | null> = new Array(total).fill(null);
    const errorsByIndex: Array<string | null> = new Array(total).fill(null);

    let completedCount = 0;
    let cursor = 0;

    const startLabel = `Storyboarder starting parallel batch (${total} episodes, concurrency ${concurrency})`;
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
        const label = `Storyboards ready: ${completedCount}/${total} episodes`;
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

    return { episodeCount: generated.length, totalShots };
  },
});

function storyboardDialogLanguageLabel(code: string | undefined): string {
  switch (code) {
    case "zh-CN":
      return "Simplified Chinese";
    case "zh-HK":
      return "Traditional Chinese";
    case "en-US":
      return "English";
    default:
      return code || "English";
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
      ? `Aim for ~${shotsPerEpisode} shots (allow ${Math.max(5, shotsPerEpisode - 3)}-${shotsPerEpisode + 3}). Each shot 2-8 seconds.`
      : "Use 15-40 shots. Each shot 2-8 seconds.";
  // Whitelist gate — when the project already has worldscenes committed
  // (scene_phase ran), force the LLM to pick a scene from the roster so
  // backfillSceneColumn hits the cache instead of creating duplicate
  // scenes on every shot. Empty roster falls back to free-form naming.
  const sceneBlock =
    sceneNames.length > 0
      ? [
          "",
          "**Available scenes (the `scene` field MUST be picked verbatim from this list — do not invent new names):**",
          ...sceneNames.map((n) => `- ${n}`),
          "",
        ]
      : [];
  const sceneRule =
    sceneNames.length > 0
      ? '- **scene** — scene name, **must** be picked verbatim from the "Available scenes" list above; if none fits, pick the closest one — do not invent new names.'
      : "- **scene** — scene name (reuse names that already appear in the script when possible; the frontend auto-linkifies them).";
  return [
    `Break the following episode script into a storyboard table. Return JSON whose \`rows\` field is the array of shots.`,
    "",
    `Episode title: ${ep.title}`,
    "Script:",
    "```",
    ep.scriptContent,
    "```",
    ...sceneBlock,
    "Output language:",
    `- **The \`dialogue\` field (lines + narration) must be in ${langLabel}.**`,
    "- `description` / `image_prompt` / `video_prompt` should default to English; if the project context provides a `dialogLanguage`, follow it for consistency.",
    "",
    "Each row in `rows` must follow these field rules strictly:",
    sceneRule,
    "- **description** — one-line shot description (human-readable; character / scene names are fine).",
    // image_prompt / video_prompt specs aligned with the legacy skill files
    // (apps/server/src/ai/skills/prompt_format_cn.skill.md — the "Pax"
    // authoritative format). Previously we had one-line hand-wavy bullets
    // that produced 20-60 char prompts; now forcing structured field cards
    // at 120-220 chars for image, three-part structure for video.
    "- **image_prompt** — **single-frame** image-generation prompt, structured multi-line card, **120-220 characters / ~80-150 English words**. Strict field order:",
    "  English example:",
    "  ```",
    "  Visual: <subject + environment + material detail + spatial layout (foreground - midground - background) + lighting + visible physical phenomena; do NOT write a chain of character actions>",
    "  Shot size: <extreme wide / wide / medium / close / close-up / extreme close-up>",
    "  Angle: <high angle / low angle / eye level / bird's eye / over-the-shoulder>",
    "  Lens: <14mm ultra-wide / 24mm wide / 50mm standard / 85mm short telephoto>",
    "  Composition: <diagonal / leading lines / centered / rule of thirds>",
    "  Lighting: <warm / cool / backlit / sidelit / golden hour / blue hour / ...>",
    "  Mood: <emotion + texture, one sentence>",
    "  ```",
    "  Chinese example (when `dialogLanguage = zh-CN`):",
    "  ```",
    "  画面描述：<主体 + 环境 + 材质细节 + 空间位置关系（前景-中景-后景）+ 光影效果 + 可见物理现象；不写角色连续动作链>",
    "  景别：<大远景 / 全景 / 中景 / 近景 / 特写 / 极特写>",
    "  拍摄角度：<俯拍 / 仰拍 / 平视 / 鸟瞰 / 过肩>",
    "  镜头焦距：<14mm 超广角 / 24mm 广角 / 50mm 标准 / 85mm 中长焦>",
    "  构图：<对角线 / 引导线 / 中心 / 三分法>",
    "  光影：<暖光 / 冷光 / 逆光 / 侧光 / 黄金时刻 / 蓝调时刻 / ...>",
    "  画面氛围：<情绪与质感，一句话>",
    "  ```",
    "  Blocking is mandatory: if a key prop / character / door / table / light source appears, write its relative position (left / right / foreground / background / inside the doorframe / end of the corridor). **Do not** add style/quality tokens (cinematic / 8K / photorealistic / masterpiece) — the project's `stylePainting` is appended downstream.",
    "- **video_prompt** — motion video prompt, **strict three-part structure** (A / B / C, one line each):",
    "  ```",
    "  A. Camera motion: <camera position + movement + push-in / lateral / tracking / locked with micro-motion / focus rack>",
    "  B. Action: <continuous action + environmental reaction + physical detail; a generatable dynamic process>",
    '  C. Audio: <default "no voice, no dialogue, no background music"; natural ambient sound is allowed (wind / snow / fire / fabric friction), no human voice or score>',
    "  ```",
    '  **Hard-conflict check**: if the `dialogue` field is empty or `-`, the B section must not include "speaking / shouting / screaming" — only mouth-shape opening/closing, breathing, facial action.',
    `- **shot_size** — pick one from the enum (Java enum values, keep them verbatim): ${SHOT_SIZE_OPTIONS}`,
    `- **perspective** — pick one from the enum (Java enum values, keep them verbatim): ${PERSPECTIVE_OPTIONS}`,
    `- **movement** — pick one from the enum (Java enum values, keep them verbatim): ${MOVEMENT_OPTIONS}`,
    "- **dialogue** — line or narration, format `Character: line` or `Narrator: ...` (or the equivalent in the dialogue language); leave empty when silent.",
    "- **duration** — shot length in seconds, 2-8.",
    "",
    shotRangeLine,
    contentLanguageInstruction(resolveContentLanguage(dialogLanguage)),
  ].join("\n");
}

// ─── Step 2: emit awaiting-review + end ───────────────────────────────

const emitReviewStep = createStep({
  id: "emit_review",
  inputSchema: z.object({ episodeCount: z.number(), totalShots: z.number() }),
  outputSchema: StoryboardPhaseOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (!runId) throw new Error("runId missing");
    const ctx = getContext(requestContext);

    await reportProgress(runId, {
      stepId: "storyboard_phase.review",
      current: inputData.episodeCount,
      total: inputData.episodeCount,
      label: `Storyboards ready for review: ${inputData.episodeCount} episodes (${inputData.totalShots} shots)`,
    });

    const drafts = await listDrafts<StoryboardDraftData>(runId, {
      entityType: "shot",
      statuses: ["pending"],
    });
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
      estimatedCost: drafts.length * PRICES.storyboardPerEpisode,
      // Terminal phase — no nextAction; UI falls back to "完成" label.
    });

    return {
      runId,
      draftCount: drafts.length,
      message: `Generated ${inputData.episodeCount} storyboard drafts — awaiting review.`,
    };
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
 *
 * Also consume any leading `@` so the storyboarder LLM's `@苏晚晴`
 * shorthand doesn't end up as `@<mention>苏晚晴</mention>` — Tiptap's
 * mention node component adds the `@` visual itself, so a raw leading
 * `@` produces a `@@` duplicate on render.
 */
function injectMentions(map: MentionMap, text: string): string {
  if (!text) return "";
  const sorted = [...map.values()].sort((a, b) => b.name.length - a.name.length);
  let result = text;
  for (const entry of sorted) {
    const re = new RegExp(`@?${escapeRegex(entry.name)}`, "g");
    result = result.replace(re, buildMentionTag(entry));
  }
  return result;
}

/**
 * Resolve a scene name to its Java worldscene id. Thin wrapper around
 * the shared `resolveSceneIdByName` — the phase is expected to share
 * the cache across all episodes in a run, so it passes the same map
 * into every call.
 */
async function resolveSceneId(
  ctx: import("../../lib/workspace-client").StoryosContext,
  sceneName: string,
  cache: Map<string, string>
): Promise<string> {
  const worldId = ctx.worldId ?? "";
  if (!worldId) return "";
  try {
    return await resolveSceneIdByName(ctx, worldId, sceneName, cache);
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
      // SCENE column is multi-value on Java — scalar `value` is
      // silently discarded. Use `values: [sceneId]` to match the
      // frontend persistValueList write path.
      await javaRequest(ctx, "/api/user/shotValue/input", {
        data: {
          shotId,
          shotColumnId: sceneColumnId,
          value: "",
          values: [sceneId],
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

// ─── Compose ──────────────────────────────────────────────────────────

export const storyboardPhaseWorkflow = createWorkflow({
  id: "storyboard_phase",
  description:
    "Storyboard phase: per episode, call the storyboarder to produce shot rows → drafts into Redis → wait for user confirmation. After approval, apply_phase_drafts commits to Java.",
  inputSchema: StoryboardPhaseInputSchema,
  outputSchema: StoryboardPhaseOutputSchema,
})
  .then(resolveInputStep)
  .then(generateStep)
  .then(emitReviewStep)
  .commit();

export type StoryboardPhaseOutput = z.infer<typeof StoryboardPhaseOutputSchema>;

// ─── Apply helper ──────────────────────────────────────────────────────

export interface ApplyStoryboardDraftsOptions {
  ctx: StoryosContext;
  runId: string;
  approved: boolean;
  feedback?: string;
  acceptedClientRefIds?: string[];
  /** See role-phase.applyRoleDrafts for rationale. */
  emitLifecycleMessage?: boolean;
}

export interface ApplyStoryboardDraftsResult {
  outcome: "committed" | "partial_failure" | "rejected";
  committedCount: number;
  failedCount: number;
  message: string;
  completion: WorkflowCompletedOutput | null;
  failure: WorkflowFailedOutput | null;
}

export async function applyStoryboardDrafts(
  opts: ApplyStoryboardDraftsOptions
): Promise<ApplyStoryboardDraftsResult> {
  const { ctx, runId, approved, feedback, acceptedClientRefIds } = opts;
  const emitLifecycleMessage = opts.emitLifecycleMessage ?? true;
  await throwIfCancelled(runId);

  const stylePainting = ctx.stylePainting ?? "";

  const pending = await listDrafts<StoryboardDraftData>(runId, {
    entityType: "shot",
    statuses: ["pending"],
  });
  const pendingRefIds = pending.map((d) => d.clientRefId);

  if (pendingRefIds.length > 0) {
    await deductCredits(ctx, {
      amount: pendingRefIds.length * PRICES.storyboardPerEpisode,
      reason: `storyboard_phase ${pendingRefIds.length} drafts (approved=${approved})`,
      idempotencyKey: phaseDeductKey(runId, "storyboard_phase"),
    });
  }

  if (!approved) {
    for (const id of pendingRefIds) await markDraftDiscarded(runId, id);
    const failurePayload: WorkflowFailedOutput = {
      runId,
      workflowName: "storyboard_phase",
      terminalStatus: "cancelled",
      error: feedback ? `User requested changes: ${feedback}` : "User rejected.",
      retryable: false,
    };
    if (emitLifecycleMessage) {
      await publishWorkflowFailed(ctx.projectId, runId, "storyboard_phase", {
        terminalStatus: failurePayload.terminalStatus,
        error: failurePayload.error,
        retryable: failurePayload.retryable,
      });
    }
    return {
      outcome: "rejected",
      committedCount: 0,
      failedCount: 0,
      message: feedback
        ? `Storyboard phase rejected. Feedback: ${feedback}`
        : "Storyboard phase rejected.",
      completion: null,
      failure: failurePayload,
    };
  }

  // Load worldrole + worldscene rosters so we can replace plain names in
  // description / image_prompt / video_prompt with Tiptap <mention> tags.
  const mentionMap = await buildMentionMap(ctx);

  // Scene name → worldscene id cache, shared across all episodes.
  const sceneIdCache = new Map<string, string>();
  for (const [key, entry] of mentionMap.entries()) {
    if (entry.type === "scene" && entry.id) sceneIdCache.set(key, entry.id);
  }

  const accepted = acceptedClientRefIds ? new Set(acceptedClientRefIds) : null;
  const accepts = pending.filter((d) => !accepted || accepted.has(d.clientRefId));

  for (const it of accepts) await markDraftCommitting(runId, it.clientRefId);

  await publishWorkflowProgress(ctx.projectId, runId, "storyboard_phase", "committing", {
    current: 0,
    total: accepts.length,
    label: `Saving ${accepts.length} storyboard episodes…`,
  });

  const committed: Array<{ episodeId: string; title: string; shotCount: number }> = [];
  const failed: Array<{ episodeId: string; title: string; reason: string }> = [];

  let i = 0;
  for (const d of accepts) {
    await throwIfCancelled(runId);
    const label = `Saving storyboard: ${i + 1}/${accepts.length} — ${d.data.title}`;
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
      const shotNo = r.shot_no && r.shot_no.trim() ? r.shot_no : String(idx + 1);
      return [
        shotNo,
        r.scene ?? "",
        injectMentions(mentionMap, r.description ?? ""),
        injectMentions(mentionMap, r.image_prompt),
        injectMentions(mentionMap, r.video_prompt ?? ""),
        stylePainting,
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

      // Backfill scene column with worldscene ids (soft-failing).
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

  const outcome = failed.length === 0 ? ("committed" as const) : ("partial_failure" as const);
  if (failed.length === 0) await deleteAllDrafts(runId);

  if (committed.length > 0) {
    await publishEntityEvent(ctx, {
      entity: "storyboard",
      action: "batch_created",
      source: "storyboard_phase",
    });
  }

  const endLabel = `Storyboards committed: ${committed.length} ok / ${failed.length} failed`;
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

  // Locale-agnostic summary: emit a key + params so the frontend renders
  // in the user's locale. `message` on the tool return stays a plain-English
  // log string (server logs / metrics only, never shown to the user).
  const summaryKey =
    outcome === "committed" ? "storyboardPhaseSummaryCommitted" : "storyboardPhaseSummaryPartial";
  const summaryParams =
    outcome === "committed"
      ? { count: committed.length }
      : { failed: failed.length, total: accepts.length };
  const logMessage =
    outcome === "committed"
      ? `committed ${committed.length} episodes' storyboards`
      : `partial failure: ${failed.length}/${accepts.length}`;

  // Terminal workflow — no nextSteps (storyboard is the end of the chain).
  const completionPayload: WorkflowCompletedOutput = {
    runId,
    workflowName: "storyboard_phase",
    committed: committed.map((c) => ({ serverId: c.episodeId, title: c.title })),
    failed: failed.map((f) => ({ clientRefId: f.episodeId, reason: f.reason })),
    summaryKey,
    summaryParams,
  };
  if (emitLifecycleMessage) {
    await publishWorkflowCompleted(ctx.projectId, runId, "storyboard_phase", {
      committed: completionPayload.committed,
      failed: completionPayload.failed,
      summaryKey: completionPayload.summaryKey,
      summaryParams: completionPayload.summaryParams,
    });
  }

  return {
    outcome,
    committedCount: committed.length,
    failedCount: failed.length,
    message: logMessage,
    completion: completionPayload,
    failure: null,
  };
}
