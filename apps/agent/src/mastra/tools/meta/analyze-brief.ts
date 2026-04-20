/**
 * analyze_brief — quick "before anything else" structured extraction from
 * the user's raw material. Runs ONE lightweight LLM call and returns:
 *
 *   - projectMeta     { name, description, core }      → silent project init
 *   - suggestedParams { stylePainting, chapterLength,
 *                       targetEpisodeCount,
 *                       dialogLanguage,
 *                       aspectRatioType, reasoning }   → params-form defaults
 *   - themeSummary    string                           → 3-段叙述 seed
 *
 * Called by the supervisor BEFORE require_project_params on a fresh project
 * with material. Fast (~3-5s on router model, deepseek-chat / qwen3-max)
 * and cheap (short prompt + small output), so it's OK to make this a
 * synchronous supervisor tool rather than a BullMQ workflow.
 *
 * Accepts either `text` (raw content) or `textRef` (attachment id `att_...`);
 * the ref is resolved from Redis the same way invoke_workflow does.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getRedis } from "../../lib/redis-client";

const ProjectMetaShape = z.object({
  name: z.string().min(1).max(40),
  description: z.string().min(1).max(120),
  core: z.string().min(1).max(200),
});

const SuggestedParamsShape = z.object({
  stylePainting: z.string().min(1),
  chapterLength: z.number().int().min(3).max(30),
  targetEpisodeCount: z.number().int().min(1).max(40),
  dialogLanguage: z.enum(["zh-CN", "zh-HK", "en-US"]),
  aspectRatioType: z.enum(["_16_9", "_9_16", "_1_1", "_4_3", "_21_9", "_3_4"]),
  reasoning: z.string().min(1).max(200),
});

const BriefShape = z.object({
  projectMeta: ProjectMetaShape,
  suggestedParams: SuggestedParamsShape,
  themeSummary: z.string().min(1).max(200),
});

export type AnalyzeBriefOutput = z.infer<typeof BriefShape>;

// Input size guard. The router model takes short prompts; if the user
// attaches a whole novel, truncate to something sensible. The downstream
// story_outline workflow will see the full text later.
const MAX_TEXT_CHARS = 6000;

async function resolveText(input: { text?: string; textRef?: string }): Promise<string> {
  if (input.text && input.text.trim().length > 0) {
    return input.text.trim().slice(0, MAX_TEXT_CHARS);
  }
  if (input.textRef && input.textRef.startsWith("att_")) {
    const redis = getRedis();
    const raw = await redis.get(`attachment:${input.textRef}`);
    if (!raw) throw new Error(`Attachment ref not found or expired: ${input.textRef}`);
    const parsed = JSON.parse(raw) as { text?: string };
    if (typeof parsed.text !== "string") {
      throw new Error(`Attachment ${input.textRef} has no text field`);
    }
    return parsed.text.trim().slice(0, MAX_TEXT_CHARS);
  }
  throw new Error("analyze_brief: must supply `text` or `textRef`");
}

function buildPrompt(text: string): string {
  return [
    "下面是用户提供的原始创作素材（可能是小说片段、梗概、一句话主题等）。",
    "请按你 system prompt 规定的 JSON 结构返回简报。",
    "",
    "原始素材：",
    text,
  ].join("\n");
}

export const analyzeBrief = createTool({
  id: "analyze_brief",
  description:
    "从用户的原始创作素材里提取项目简报（项目名/一句话梗概/视觉核心）+ 推荐参数（画风/画幅/单集时长/集数/对白语言）。必须在新项目且用户已给素材/梗概的场景下使用，用来在弹 require_project_params 之前填好默认值 + 顺手给项目命名。只读问题、已有素材分析过的项目、无素材的项目不要调用。",
  inputSchema: z.object({
    text: z
      .string()
      .optional()
      .describe("Raw material text. Prefer textRef for anything longer than a paragraph."),
    textRef: z
      .string()
      .optional()
      .describe('Attachment ref "att_xxx" — resolved from Redis before analysis.'),
  }),
  outputSchema: BriefShape,
  execute: async ({ text, textRef }, execCtx) => {
    const resolvedText = await resolveText({ text, textRef });

    const analyst = execCtx?.mastra?.getAgent("briefAnalyzer");
    if (!analyst) throw new Error("briefAnalyzer agent not registered");

    const response = await analyst.generate(buildPrompt(resolvedText), {
      structuredOutput: { schema: BriefShape, errorStrategy: "warn" },
    });
    const brief = response.object as AnalyzeBriefOutput | undefined;

    if (!brief) {
      // eslint-disable-next-line no-console
      console.warn(
        "[analyze_brief] briefAnalyzer returned no structured output; raw text head:",
        typeof response.text === "string" ? response.text.slice(0, 200) : "(none)"
      );
      // Fall back to a minimal default so the supervisor can still
      // proceed — downstream won't silent-save a default name, and the
      // params form will just show hardcoded defaults.
      return {
        projectMeta: { name: "", description: "", core: "" },
        suggestedParams: {
          stylePainting: "2",
          chapterLength: 12,
          targetEpisodeCount: 10,
          dialogLanguage: "zh-CN" as const,
          aspectRatioType: "_16_9" as const,
          reasoning: "briefAnalyzer 未返回结构化结果，使用系统默认参数",
        },
        themeSummary: "",
      };
    }

    return brief;
  },
});
