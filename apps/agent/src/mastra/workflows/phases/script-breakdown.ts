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
import { getContext } from "../../lib/workspace-client";

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
 */
const CastRosterEntrySchema = z.object({
  name: z.string().min(1).max(20),
  role: stringLike,
  arc: stringLike,
  firstAppearance: z.string().optional(),
});

/**
 * Settings roster — NAME + type hint only. No atmosphere / lighting /
 * specific dressing. The scene designer persona elaborates from this.
 */
const SettingsRosterEntrySchema = z.object({
  name: z.string().min(1).max(30),
  typeHint: stringLike,
  firstAppearance: z.string().optional(),
});

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
});

export const ScriptBreakdownInputSchema = z.object({
  /** Raw text to analyze — novel chapters, outline, draft script, etc. */
  text: z.string().min(1, "text is required"),
  /** Optional user hint to steer tone / genre ("爱情喜剧" / "悬疑惊悚" etc.) */
  styleHint: z.string().optional(),
});

export const ScriptBreakdownOutputSchema = BreakdownShape;

// ─── Single step (analyst call) ───────────────────────────────────────

const analyzeStep = createStep({
  id: "analyze",
  inputSchema: ScriptBreakdownInputSchema,
  outputSchema: ScriptBreakdownOutputSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const runId = requestContext?.get("runId") as string | undefined;
    if (runId) {
      await throwIfCancelled(runId);
      await reportProgress(runId, {
        stepId: "analyze",
        current: 0,
        total: 1,
        label: "剧本统筹正在拆解素材…",
      });
    }

    const storyEditor = mastra?.getAgent("storyEditor");
    if (!storyEditor) throw new Error("storyEditor agent not registered");

    const prompt = buildStoryEditorPrompt(inputData);

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
      await reportProgress(runId, {
        stepId: "analyze",
        current: 1,
        total: 1,
        label: `骨架就绪：${result.structure.length} 章 · ${result.cast.length} 角色 · ${result.settings?.length ?? 0} 场景`,
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
    "4. threads.main 要提炼贯穿全文的核心线索，subs 列出交织的支线。",
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
