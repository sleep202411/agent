/**
 * script_breakdown — Step 1 of the production pipeline.
 *
 * Owned by the storyEditor persona (剧本统筹 / Story Editor). Compresses raw
 * source material (novels, outlines, draft scripts) into a structured
 * narrative skeleton: chapter structure + threads + cast roster + settings
 * roster. Does NOT do character or scene design — those are downstream
 * personas' jobs. The skeleton is a shared artifact that all subsequent
 * phases (role_phase / episode_phase / script_phase / storyboard_phase) read
 * from instead of re-analyzing raw text.
 *
 * No HITL here — skeleton extraction is a pure transform. HITL gates live in
 * the phase workflows that consume this skeleton.
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { reportProgress, throwIfCancelled } from "../engine";
import { putOutline, type StoryOutline } from "../../lib/outline";
import { getContext, javaRequest, type StoryosContext } from "../../lib/workspace-client";
import { publishWorkflowCompleted, publishWorkflowProgress } from "../../lib/workflow-messages";
import { PRICES, deductCredits, phaseDeductKey } from "../../lib/billing";

// ─── Schemas ───────────────────────────────────────────────────────────

/**
 * DeepSeek sometimes emits arrays where we expect a single string.
 * Coerce by joining with Chinese enumeration comma.
 */
const stringLike = z.preprocess((val) => {
  if (Array.isArray(val)) return val.map((v) => String(v)).join("、");
  return val;
}, z.string().min(1));

const KeyEventsSchema = z.preprocess(
  (val) => {
    if (typeof val === "string") return val.split(/[、,，]\s*/).filter(Boolean);
    return val;
  },
  z.array(z.string().min(1)).min(1)
);

const ChapterSchema = z.object({
  chapterId: z.string().min(1),
  title: z.string().min(1).max(80),
  summary: stringLike,
  keyEvents: KeyEventsSchema,
  emotion: stringLike,
  hookToNext: z.string().optional(),
});

const SubThreadSchema = z.object({
  name: z.string().min(1).max(30),
  description: stringLike,
  linkedChapterIds: z.array(z.string()).optional(),
});

const ThreadsSchema = z.object({
  main: stringLike,
  subs: z.array(SubThreadSchema).default([]),
});

/**
 * Cast roster — NAME + role + one-line arc only. No appearance / personality.
 * The character designer persona elaborates from this in role_phase.
 *
 * DeepSeek occasionally drops `role` or `arc` on secondary cast entries when
 * it races through the tail of a long list. We preprocess to fill in
 * "原文未明示" (matches the persona's own fallback instruction) so one missing
 * sub-field doesn't nuke the whole run.
 */
const CastRosterEntrySchema = z.preprocess(
  (val) => {
    if (!val || typeof val !== "object") return val;
    const obj = val as Record<string, unknown>;
    return {
      ...obj,
      role: obj.role ?? "原文未明示",
      arc: obj.arc ?? "原文未明示",
    };
  },
  z.object({
    name: z.string().min(1).max(20),
    role: stringLike,
    arc: stringLike,
    firstAppearance: z.string().optional(),
  })
);

/**
 * Settings roster — NAME + type hint only. No atmosphere / lighting /
 * specific dressing. The scene designer persona elaborates from this.
 */
const SettingsRosterEntrySchema = z.preprocess(
  (val) => {
    if (!val || typeof val !== "object") return val;
    const obj = val as Record<string, unknown>;
    return {
      ...obj,
      typeHint: obj.typeHint ?? "未明示",
    };
  },
  z.object({
    name: z.string().min(1).max(30),
    typeHint: stringLike,
    firstAppearance: z.string().optional(),
  })
);

/**
 * Props roster — NAME + type hint only. No detailed design / materials.
 * The prop designer persona elaborates from this.
 */
const PropsRosterEntrySchema = z.preprocess(
  (val) => {
    if (!val || typeof val !== "object") return val;
    const obj = val as Record<string, unknown>;
    return {
      ...obj,
      typeHint: obj.typeHint ?? "未明示",
    };
  },
  z.object({
    name: z.string().min(1).max(30),
    typeHint: stringLike,
    firstAppearance: z.string().optional(),
  })
);

const BreakdownShape = z.object({
  storySummary: z.preprocess((val) => {
    if (Array.isArray(val)) return val.map((v) => String(v)).join(" ");
    return val;
  }, z.string().min(30)),
  genre: z.string().min(1),
  tone: z.string().min(1),
  structure: z.array(ChapterSchema).min(1),
  threads: ThreadsSchema,
  cast: z.array(CastRosterEntrySchema).min(1),
  settings: z.array(SettingsRosterEntrySchema).default([]),
  props: z.array(PropsRosterEntrySchema).default([]),
});

export const ScriptBreakdownInputSchema = z.object({
  /**
   * Raw text to analyze — novel chapters, outline, draft script, etc.
   * Optional: if omitted, story_outline falls back to concatenating
   * already-committed episode scripts from Java (the post-parse_script
   * "走完整资产" path, where user already has episodes in DB and just
   * wants skeleton extracted from them).
   */
  text: z.string().optional(),
  /** Optional user hint to steer tone / genre ("爱情喜剧" / "悬疑惊悚" etc.) */
  styleHint: z.string().optional(),
});

/** Pulls committed episode scripts from Java and concats them into the
 *  raw text story_outline needs. Used when caller didn't pass `text`
 *  (post parse_script flow). */
async function loadTextFromCommittedEpisodes(ctx: StoryosContext): Promise<string> {
  type Ep = { id: string | number; title?: string; sort?: number };
  const listed = await javaRequest<{ list?: Ep[] }>(ctx, "/api/user/world/list/episode", {
    data: { productId: ctx.projectId, page: 1, pageSize: 999 },
  });
  const episodes = (listed.list ?? [])
    .filter((ep) => ep.id != null)
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
  if (episodes.length === 0) return "";
  const parts = await Promise.all(
    episodes.map(async (ep, i) => {
      try {
        const res = await javaRequest<{ content?: string; script?: string }>(
          ctx,
          `/api/user/project/scripts/episode/detail/${encodeURIComponent(String(ep.id))}`
        );
        const raw = res.content ?? res.script ?? "";
        const plain = htmlToPlainText(raw);
        if (!plain.trim()) return "";
        const header = `## 第 ${i + 1} 集 ${ep.title ?? ""}`.trim();
        return `${header}\n\n${plain}`;
      } catch {
        return "";
      }
    })
  );
  return parts.filter(Boolean).join("\n\n---\n\n");
}

function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const ScriptBreakdownOutputSchema = BreakdownShape;

// ─── Single step (analyst call) ───────────────────────────────────────

const analyzeStep = createStep({
  id: "analyze",
  inputSchema: ScriptBreakdownInputSchema,
  outputSchema: ScriptBreakdownOutputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    const ctx = getContext(requestContext);
    if (runId) {
      await throwIfCancelled(runId);
      const startLabel = "剧本统筹正在拆解素材…";
      await reportProgress(runId, {
        stepId: "analyze",
        current: 0,
        total: 1,
        label: startLabel,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "story_outline", "planning", {
        current: 0,
        total: 1,
        label: startLabel,
      });
    }

    // Resolve the text to analyze: LLM-supplied first, fall back to
    // committed-episode scripts (post parse_script "走完整资产" path).
    let effectiveText = inputData.text?.trim() ?? "";
    if (!effectiveText) {
      effectiveText = await loadTextFromCommittedEpisodes(ctx);
      if (!effectiveText) {
        throw new Error(
          "story_outline: no text provided and no committed episodes to source from — run parse_script first or pass `text` explicitly"
        );
      }
      // eslint-disable-next-line no-console
      console.log(
        `[script_breakdown] sourced ${effectiveText.length} chars from committed episodes for project ${ctx.projectId}`
      );
    }

    const storyEditor = mastra?.getAgent("storyEditor");
    if (!storyEditor) throw new Error("storyEditor agent not registered");

    const prompt = buildStoryEditorPrompt({
      text: effectiveText,
      styleHint: inputData.styleHint,
    });

    // eslint-disable-next-line no-console
    console.log(`[script_breakdown] storyEditor prompt length: ${prompt.length} chars`);

    let response: Awaited<ReturnType<typeof storyEditor.generate>>;
    try {
      response = await storyEditor.generate(prompt, {
        structuredOutput: {
          schema: BreakdownShape,
          // Surface schema-mismatch errors instead of silently returning
          // undefined — otherwise we only see "no cast" with no cause.
          errorStrategy: "strict",
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        "[script_breakdown] storyEditor.generate threw:",
        err instanceof Error ? err.message : err,
        err instanceof Error ? err.stack : undefined
      );
      throw err;
    }

    const result = response.object as z.infer<typeof BreakdownShape> | undefined;
    if (!result || !result.cast || result.cast.length === 0) {
      // eslint-disable-next-line no-console
      console.error(
        "[script_breakdown] storyEditor returned no cast. Raw response keys:",
        Object.keys(response ?? {}),
        "text head:",
        typeof response.text === "string" ? response.text.slice(0, 500) : "(no .text)",
        "object:",
        JSON.stringify(response.object ?? null).slice(0, 500)
      );
      throw new Error("storyEditor returned no cast — skeleton extraction failed");
    }

    if (runId) {
      const endLabel = `骨架就绪：${result.structure.length} 章 · ${result.cast.length} 角色 · ${result.settings?.length ?? 0} 场景`;
      await reportProgress(runId, {
        stepId: "analyze",
        current: 1,
        total: 1,
        label: endLabel,
      });
      await publishWorkflowProgress(ctx.projectId, runId, "story_outline", "planning", {
        current: 1,
        total: 1,
        label: endLabel,
      });
      // Charge for the outline run — no HITL, so deduct once on success.
      // Fixed price (not draft-count-based) because the product here is a
      // single skeleton, not a collection of items.
      await deductCredits(ctx, {
        amount: PRICES.storyOutlineRun,
        reason: `story_outline runId=${runId}`,
        idempotencyKey: phaseDeductKey(runId, "story_outline"),
      });
      // story_outline has no HITL — outline is a deterministic skeleton.
      // User picks the next step explicitly (full flow starts with role
      // phase; "just outline" users stop here).
      await publishWorkflowCompleted(ctx.projectId, runId, "story_outline", {
        committed: [{ serverId: ctx.projectId, title: "故事骨架" }],
        summary: endLabel,
        // Attach the structured skeleton so the completed card can show
        // chapter titles / cast / settings inline — users were seeing
        // just "5 章 · 5 角色 · 5 场景" with no way to glimpse the actual
        // content.
        result: {
          storySummary: result.storySummary,
          genre: result.genre,
          tone: result.tone,
          structure: result.structure.map((c) => ({ title: c.title, summary: c.summary })),
          cast: result.cast.map((c) => ({ name: c.name, role: c.role })),
          settings: (result.settings ?? []).map((s) => ({
            name: s.name,
            typeHint: s.typeHint,
          })),
        },
        nextSteps: [
          {
            workflowName: "role_phase",
            labelKey: "workflowNextContinueToRoles",
            variant: "primary",
          },
        ],
      });
    }

    return result;
  },
});

function buildStoryEditorPrompt(input: z.infer<typeof ScriptBreakdownInputSchema>): string {
  const styleBlock = input.styleHint ? `\n\n用户想要的风格提示：${input.styleHint}\n` : "";
  return [
    "请对以下原始素材做**剧本统筹级的骨架拆解**。只产出结构 / 线索 / 名册，**不要**做角色和场景的详细设计。严格按约定的 JSON schema 返回。",
    "",
    "```",
    input.text,
    "```",
    styleBlock,
    "",
    "核心要求：",
    "1. structure 必须覆盖全文，章节划分合理（短篇 3-5 章，中篇 5-15 章，长篇按原文分章）。",
    "2. cast 里**只列角色名册**（name + role + 一句话 arc），不要写外貌/性格/台词——这是角色设计师下一步的活。",
    "3. settings 同理，只列场地名册 + typeHint，不要写氛围/光线/陈设。",
    "4. props 列剧情里**明确出现且被角色互动的物件**名册 + typeHint。包括但不限于：身份象征物（玉佩、官印、令牌、头冠）、关键证物（信件、画像、手札、照片）、触发物（穿越钥匙、契约、戒指、古董）、武器或工具、信物（定情物、家传物）、反复出现的道具（烟斗、折扇、药瓶）。只要剧情提到且推动情节/区分角色/承载情感，就应当列入（用户会在下一步审查）。只排除纯背景陈设（桌椅杯盘、一次性食物饮品）。**通常至少 3-8 个；返回空数组仅限于极简抽象叙事、纯对话独幕剧或类似场景**。",
    "5. threads.main 要提炼贯穿全文的核心线索，subs 列出交织的支线。",
  ].join("\n");
}

// ─── Persist step — write skeleton to Redis keyed by projectId ──────

const persistStep = createStep({
  id: "persist",
  inputSchema: ScriptBreakdownOutputSchema,
  outputSchema: ScriptBreakdownOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const ctx = getContext(requestContext);
    const runId = (requestContext?.get("runId") as string | undefined) ?? "";
    try {
      await putOutline(ctx.projectId, inputData as StoryOutline, { runId });
    } catch (err) {
      // Persistence failure shouldn't kill the workflow — the skeleton is
      // still returned in the run result, just not cached for downstream
      // phases. Downstream can gracefully fall back to regenerate.
      // eslint-disable-next-line no-console
      console.warn(
        "[story_outline] persist failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
    return inputData;
  },
});

// ─── Compose ──────────────────────────────────────────────────────────

export const scriptBreakdownWorkflow = createWorkflow({
  id: "story_outline",
  description:
    "剧本统筹：读原始素材 → 压缩成故事骨架（章节/线索/角色名册/场景名册），写入 Redis 供下游阶段使用。",
  inputSchema: ScriptBreakdownInputSchema,
  outputSchema: ScriptBreakdownOutputSchema,
})
  .then(analyzeStep)
  .then(persistStep)
  .commit();

export type ScriptBreakdownOutput = z.infer<typeof ScriptBreakdownOutputSchema>;
