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
import { robustStructuredGenerate } from "../../lib/robust-generate";
import { contentLanguageInstruction, resolveContentLanguage } from "../../lib/language";

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
  /**
   * Body type — drives whether we route to main_flow (novel/synopsis)
   * or script_to_storyboard_flow / script_import_flow (script).
   */
  inputType: z.enum(["script", "novel", "synopsis"]),
  /** Rough count of natural breakpoints (章/场/幕) for split-planning. */
  detectedChapterCount: z.number().int().min(0).max(100),
});

export type AnalyzeBriefOutput = z.infer<typeof BriefShape>;

// Input size guard. brief-analyzer runs on the persona model (DeepSeek),
// which is cheap enough to read a whole novel. Cap generously so script
// detection (looks for scene slugs + dialogue structure early, but chapter
// count needs the tail) has plenty of signal.
const MAX_TEXT_CHARS = 50000;

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

/**
 * Rough CJK-ratio heuristic to pick a default content language when the
 * caller (supervisor pre-`configure_params`) doesn't supply one. Sampled on
 * the first 2KB — good enough for mixed docs where the intro is the
 * signal. Never returns anything other than "zh-CN" / "en-US"; callers
 * still layer `resolveContentLanguage` above this so an explicit override
 * (dialogLanguage etc) wins.
 */
function detectLangFromText(text: string): "zh-CN" | "en-US" {
  const sample = text.slice(0, 2048);
  if (sample.length === 0) return "en-US";
  const cjkCount = (sample.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjkCount / sample.length >= 0.3 ? "zh-CN" : "en-US";
}

function buildPrompt(text: string, contentLang: string): string {
  return [
    "下面是用户提供的原始创作素材（可能是小说片段、梗概、一句话主题等）。",
    "请按你 system prompt 规定的 JSON 结构返回简报。",
    "",
    "原始素材：",
    text,
    contentLanguageInstruction(contentLang),
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
    contentLanguage: z
      .string()
      .optional()
      .describe(
        'Output language for generated content (e.g. "en-US", "zh-CN", "zh-HK"). Resolved by the supervisor from project dialogLanguage / user locale. Defaults to English.'
      ),
  }),
  outputSchema: BriefShape,
  execute: async ({ text, textRef, contentLanguage }, execCtx) => {
    const resolvedText = await resolveText({ text, textRef });
    // analyze_brief runs before configure_params, so the supervisor often
    // can't supply a contentLanguage yet. Heuristic: sample the first ~2KB
    // of the material; ≥ 30% CJK → zh-CN, else en-US. This only kicks in
    // when the caller omitted contentLanguage.
    const detected = detectLangFromText(resolvedText);
    const lang = resolveContentLanguage(contentLanguage, detected);

    const analyst = execCtx?.mastra?.getAgent("briefAnalyzer");
    if (!analyst) throw new Error("briefAnalyzer agent not registered");

    try {
      const { object, attempt } = await robustStructuredGenerate<AnalyzeBriefOutput>({
        agent: analyst,
        prompt: buildPrompt(resolvedText, lang),
        schema: BriefShape,
        tag: `analyze-brief-${Date.now()}`,
        // Default isEmpty (null/undefined/empty-array) covers the common
        // "Mastra couldn't parse the response" case; malformed objects
        // are already rejected by Zod and surface as undefined.
      });
      if (attempt > 1) {
        // eslint-disable-next-line no-console
        console.info(`[analyze_brief] recovered structured output on attempt ${attempt}`);
      }
      return object;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[analyze_brief] both attempts failed — falling back to defaults: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      // Minimal defaults so the supervisor can still proceed to
      // require_project_params with hardcoded form defaults. Downstream
      // won't silent-save a default name because projectMeta is empty.
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
        inputType: "novel" as const,
        detectedChapterCount: 0,
      };
    }
  },
});
