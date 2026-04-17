/**
 * script_breakdown — takes raw creative material and produces structured
 * analysis (story summary, genre, tone, characters, scenes) for downstream
 * phases.
 *
 * No HITL here — the breakdown is a pure transform. HITL gates live in the
 * phase workflows that consume this output (role_phase confirms characters,
 * episode_phase confirms episodes).
 *
 * Phase 1: no chunking. Inputs up to ~10k tokens go in one LLM call.
 * Phase 2 (later): add chunking + cross-chunk entity merging for long docs.
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { reportProgress, throwIfCancelled } from "../engine";

// ─── Schemas ───────────────────────────────────────────────────────────

/**
 * DeepSeek often interprets "3-5 keywords" / "3-6 sentences" as arrays even
 * when we want a string. Accept either and coerce arrays by joining with
 * Chinese enumeration comma — downstream only needs a string.
 */
const stringLike = z.preprocess((val) => {
  if (Array.isArray(val)) return val.map((v) => String(v)).join("、");
  return val;
}, z.string().min(1));

const CharacterBreakdown = z.object({
  name: z.string().min(1).max(20),
  role: stringLike,
  appearance: stringLike,
  personality: stringLike,
});

const SceneBreakdown = z.object({
  name: z.string().min(1).max(30),
  description: stringLike,
});

const BreakdownShape = z.object({
  storySummary: z.preprocess((val) => {
    if (Array.isArray(val)) return val.map((v) => String(v)).join(" ");
    return val;
  }, z.string().min(10)),
  genre: z.string().min(1),
  tone: z.string().min(1),
  characters: z.array(CharacterBreakdown).min(1),
  scenes: z.array(SceneBreakdown).default([]),
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
        label: "素材分析师正在阅读素材…",
      });
    }

    const analyst = mastra?.getAgent("analyst");
    if (!analyst) throw new Error("analyst agent not registered");

    const prompt = buildAnalystPrompt(inputData);

    // eslint-disable-next-line no-console
    console.log(`[script_breakdown] analyst prompt length: ${prompt.length} chars`);

    let response: Awaited<ReturnType<typeof analyst.generate>>;
    try {
      response = await analyst.generate(prompt, {
        structuredOutput: {
          schema: BreakdownShape,
          // Surface schema-mismatch errors instead of silently returning
          // undefined — otherwise we only see "no characters" with no cause.
          errorStrategy: "strict",
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        "[script_breakdown] analyst.generate threw:",
        err instanceof Error ? err.message : err,
        err instanceof Error ? err.stack : undefined
      );
      throw err;
    }

    const result = response.object as z.infer<typeof BreakdownShape> | undefined;
    if (!result || !result.characters || result.characters.length === 0) {
      // eslint-disable-next-line no-console
      console.error(
        "[script_breakdown] analyst returned no characters. Raw response keys:",
        Object.keys(response ?? {}),
        "text head:",
        typeof response.text === "string" ? response.text.slice(0, 500) : "(no .text)",
        "object:",
        JSON.stringify(response.object ?? null).slice(0, 500)
      );
      throw new Error("analyst returned no characters — analysis failed");
    }

    if (runId) {
      await reportProgress(runId, {
        stepId: "analyze",
        current: 1,
        total: 1,
        label: `分析完成：${result.characters.length} 角色、${result.scenes?.length ?? 0} 场景`,
      });
    }

    return result;
  },
});

function buildAnalystPrompt(input: z.infer<typeof ScriptBreakdownInputSchema>): string {
  const styleBlock = input.styleHint ? `\n\n用户想要的风格提示：${input.styleHint}\n` : "";
  return [
    "请分析以下素材，抽出结构化信息以 JSON 返回：",
    "",
    "```",
    input.text,
    "```",
    styleBlock,
    "",
    "严格按照约定的字段产出。characters 和 scenes 都要完整，不要遗漏原文明确出现过的。",
  ].join("\n");
}

// ─── Compose ──────────────────────────────────────────────────────────

export const scriptBreakdownWorkflow = createWorkflow({
  id: "script_breakdown",
  description: "读用户提供的素材，抽出角色/场景/故事主线等结构化信息，供下游阶段用。",
  inputSchema: ScriptBreakdownInputSchema,
  outputSchema: ScriptBreakdownOutputSchema,
})
  .then(analyzeStep)
  .commit();

export type ScriptBreakdownOutput = z.infer<typeof ScriptBreakdownOutputSchema>;
