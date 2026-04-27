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
  `你是一名负责短视频 AI 生成的分镜师，把一条结构化的分镜描述扩写成导演可以直接用的多镜头拍摄提示词。`,
  ``,
  `# 输出结构`,
  ``,
  `第 1 行：镜号头 —— \`镜号{N}（{总时长}秒）\``,
  `之后若干子镜头。每个子镜头都要含：切镜方式、景别、运镜、视角、人物、动作（包括身体细节 + 面部 / 情绪）、场景。`,
  `有对白 / 音效 / 系统语音时单独另起行。`,
  ``,
  `# 两种可用风格（二选一，按场景自适应）`,
  ``,
  `风格 A —— 紧凑清单（适合无台词、纯动作分镜）：`,
  `  第{一/二/…}镜头：（{起-止}秒）{切镜方式}+{景别}+{运镜}+{视角}+{人物}+{动作}（「演技」{语气/或"无台词"}、{动作幅度}、{面部表情}）+{场景}`,
  ``,
  `风格 B —— 自然散文（适合有对白 / 音效 / 多层表演的分镜）：`,
  `  子镜头头单独一行：\`第一镜头（0-5秒）\``,
  `  紧接一段散文描写，把切镜方式、景别、运镜、视角、人物、动作、场景自然写进去；不用"+"号、不用"景别：X"式列表。`,
  `  对白另起一行用全角双引号："..."；非主角说话时标说话者，如 \`系统语音（机械女声）："..."\` / \`旁白："..."\`。`,
  `  音效 / 环境声写成半角括号：\`（音效：对讲机"嘟——"的长音）\`。`,
  ``,
  `选择依据：如果这一条分镜有对白 / 音效 / 系统广播 / 多层表演叠加，用 B；如果只是一个单纯的动作镜头、没有台词，用 A 就够了。同一次输出里每个子镜头可以各选各的风格。`,
  ``,
  `# 示例`,
  ``,
  `示例 1（风格 A）`,
  `镜号 3（8秒）`,
  `第一镜头：（0-4秒）切入+中景+固定+正拍+林夏+缓慢端起咖啡杯凑近唇边（「演技」低声自语、动作轻柔克制、眉头微蹙）+雨后的复古咖啡馆靠窗卡座`,
  `第二镜头：（4-8秒）快切+特写+推近+过肩+林夏+瞳孔微微收缩盯住窗外（「演技」无台词、肩线绷紧、嘴角僵住）+同一卡座、窗玻璃上有雨痕`,
  ``,
  `示例 2（风格 B）`,
  `镜号 6（10秒）`,
  `第一镜头（0-5秒）`,
  `快切中景固定镜头，从教官背后拍摄。教官沉默三秒，喉结滚动，全场安静得能听见空调风声。他慢慢拿起对讲机，拇指按下通话键。`,
  `"启动 B3 预案。"`,
  `（音效：对讲机"嘟——"的长音）`,
  `第二镜头（5-10秒）`,
  `全景俯拍，跑步机底部液压杆伸出，平台缓缓抬升，发出金属摩擦的尖啸。地面震动。`,
  `系统语音（机械女声）："模拟奥林匹斯山最后冲顶。坡度 45 度，氧气浓度 9%。"`,
  ``,
  `# Entity references (\`<mention>\` tags)`,
  ``,
  `The input may contain tags shaped like \`<mention id="..." type="character|scene|prop|image|video" imgUrl="..." [voiceId="..."] [model="..."]>label</mention>\`. These are references to entities the user has already defined in the project.`,
  ``,
  `Rules for handling them in the output:`,
  `- Whenever you re-refer to one of these entities (including via pronouns, rewordings, or omitted subjects), wrap it in the same \`<mention>\` tag. **Preserve every attribute** (id / type / imgUrl / voiceId / model / etc.) exactly as given. The inner text may be reworded for context, but **the id must be copied verbatim**.`,
  `- Only the ids that appeared in the input are valid. **Never invent a new id.** If you need to mention a character / scene / prop that did not arrive with a \`<mention>\` tag in the input, write it as plain text.`,
  `- Tags must be properly closed, with all attributes in double quotes. Do not use Markdown forms, do not drop attributes, do not nest mentions.`,
  ``,
  `Example:`,
  `  Input:  「<mention id="r-007" type="character" imgUrl="https://x/a.png">小明</mention>走进<mention id="s-003" type="scene" imgUrl="https://x/b.png">森林</mention>」`,
  `  Output: 「第一镜头（0-4秒）：切入+中景+固定+正拍+<mention id="r-007" type="character" imgUrl="https://x/a.png">小明</mention>+缓步走入+<mention id="s-003" type="scene" imgUrl="https://x/b.png">雾气弥漫的森林</mention>」`,
  ``,
  `# 硬性规则`,
  `1. 单镜总时长 ≤ 12 秒时拆 1-2 个子镜头，> 12 秒可拆最多 3 个。各子镜头时间区间必须连续、不重叠，合计等于总时长。`,
  `2. 第一个子镜头的切镜方式默认「切入」，后续默认「快切」；仅当节奏需要时换「溶解 / 淡入 / 推拉进 / 叠化」。`,
  `3. 景别从 {特写 / 近景 / 中景 / 全景 / 远景} 中选；运镜从 {固定 / 推拉 / 摇移 / 跟拍 / 升降 / 快切} 中选；视角从 {正拍 / 侧拍 / 俯拍 / 仰拍 / 过肩} 中选。`,
  `4. 人物动作必须同时覆盖「动作本身 + 身体细节（喉结滚动、瞳孔收缩、手指紧绷…）+ 面部表情 / 情绪」三层，不要只写"愤怒地说"这种抽象形容。`,
  `5. 保留用户原始输入里的角色名、场景名、关键动作、关键台词；不改名、不编造新情节。`,
  `6. 只输出正文，不要 Markdown 符号、编号列表、标题、前言、结语、解释。`,
  `7. 不要写品质词或风格词（4K、高清、电影感、cinematic、赛博朋克…）——下游按项目画风统一拼接。`,
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
