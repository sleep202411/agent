/**
 * POST /video-prompt/expand — one-shot LLM call that takes a storyboard
 * row's raw fields (rough prompt, movement, dialogue, characters, …) and
 * returns a multi-shot cinematic prompt in the "第一镜头/第二镜头" format
 * the AI video dialog wants to feed to the video model.
 *
 * Stateless / session-less: we don't persist anything. Frontend gathers
 * the row fields, posts them here, and replaces its prompt textarea with
 * the returned `prompt` string. Keeping it out of the Mastra workflow/
 * agent machinery because there's no HITL, no multi-turn, no shared state
 * to worry about — just prompt-in / text-out on Qwen.
 *
 * Model: Qwen via DashScope's OpenAI-compat endpoint (`qwen-plus`). Plus
 * over max for cost — the transformation is short and structural.
 */
import { registerApiRoute } from "@mastra/core/server";
import { generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { createAlibabaModel, defaultPersonaModel } from "../lib/models";

const ExpandRequestSchema = z.object({
  shotNumber: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
  currentPrompt: z.string().optional(),
  sceneName: z.string().optional(),
  characters: z.array(z.string()).optional(),
  /**
   * Free-form column label → plain text dict harvested from the
   * storyboard row. Covers preset fields (对白 / 运镜 / 画风 / 景别 / 视角
   * / 描述 / 字幕 …) as well as any custom columns the user added. The
   * LLM sees these as labelled hints.
   */
  fields: z.record(z.string(), z.string()).optional(),
});

type ExpandRequest = z.infer<typeof ExpandRequestSchema>;

const SYSTEM_PROMPT = [
  `你是一名负责短视频 AI 生成的分镜师，擅长把一条结构化的分镜描述，扩写成导演可以直接用的多镜头拍摄提示词。`,
  `输出要求：`,
  `1. 用「第一镜头/第二镜头/…」的结构分段，单个分镜总时长不超过 12 秒时一般拆 1-2 个子镜头，更长可以拆 3 个。`,
  `2. 每段开头写明时间区间（例如「（0-5秒）」），随后描述景别（近/中/远/特写）、运镜（固定/快切/推拉等）、角度（正拍/侧拍/俯拍等），再接人物动作和情绪。无台词的段落要写「无台词」。`,
  `3. 不要出现 Markdown 标记、列表符号、解释性前言或结语，只输出正文。`,
  `4. 保留用户原始输入中的角色名、场景名、关键动作，不要额外编造情节。`,
  `5. 如果用户给的运镜/画风/台词缺失，请结合语境做最保守合理的推断，不要堆砌形容词。`,
].join("\n");

function buildUserMessage(input: ExpandRequest): string {
  const lines: string[] = ["这是一条分镜的原始信息，请按上面要求扩写："];
  if (input.shotNumber) lines.push(`镜号：第 ${input.shotNumber} 镜`);
  if (input.durationSec) lines.push(`时长：约 ${input.durationSec} 秒`);
  if (input.sceneName) lines.push(`场景：${input.sceneName}`);
  if (input.characters?.length) {
    lines.push(`出现角色：${input.characters.join("、")}`);
  }
  if (input.currentPrompt?.trim()) {
    lines.push(`当前视频提示词（可能很粗略）：${input.currentPrompt.trim()}`);
  }

  // Generic columns — whatever the user put in the row (对白 / 运镜 /
  // 画风 / 情绪 / …). Keep their column labels so Qwen sees the intent.
  if (input.fields) {
    const entries = Object.entries(input.fields)
      .map(([k, v]) => [k.trim(), typeof v === "string" ? v.trim() : ""] as const)
      .filter(([k, v]) => k && v);
    if (entries.length > 0) {
      lines.push("", "分镜行其他字段：");
      for (const [key, value] of entries) {
        lines.push(`- ${key}：${value}`);
      }
    }
  }

  lines.push("", "请只输出扩写后的多镜头提示词正文，不要加任何说明。");
  return lines.join("\n");
}

/**
 * Prefer Qwen via DashScope (the product ask), but fall back to whatever
 * STORYOS_PERSONA_PROVIDER is configured as if the Alibaba key isn't
 * wired up on this deployment. Keeps the feature usable in dev-env's
 * that only have DeepSeek configured, without silently changing
 * behaviour when Qwen *is* available.
 */
function resolveVideoPromptModel(): LanguageModel {
  const alibabaKey = (process.env.ALIBABA_API_KEY || process.env.DASHSCOPE_API_KEY)?.trim();
  if (alibabaKey) {
    return createAlibabaModel(process.env.VIDEO_PROMPT_MODEL?.trim() || "qwen-plus");
  }
  return defaultPersonaModel();
}

export const videoPromptRoutes = [
  registerApiRoute("/video-prompt/expand", {
    method: "POST",
    handler: async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid JSON body" }, 400);
      }

      const parsed = ExpandRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "invalid input", issues: parsed.error.issues }, 400);
      }

      try {
        const model = resolveVideoPromptModel();
        const { text } = await generateText({
          model,
          system: SYSTEM_PROMPT,
          prompt: buildUserMessage(parsed.data),
          temperature: 0.6,
        });

        const cleaned = text.trim();
        if (!cleaned) {
          return c.json({ error: "empty response from model" }, 502);
        }
        return c.json({ prompt: cleaned });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error("[video-prompt/expand] LLM call failed:", message);
        return c.json({ error: `expand failed: ${message}` }, 500);
      }
    },
  }),
];
