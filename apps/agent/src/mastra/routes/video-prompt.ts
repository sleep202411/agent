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
  `You are a storyboard director for short-video AI generation. Your job is to expand one structured storyboard row into a multi-shot, on-set-ready prompt that a video-generation model can shoot from directly.`,
  ``,
  `# Output language`,
  ``,
  `Match the input language. The input prompt and the surrounding row fields tell you which language to use for the output:`,
  `- Input mostly in English → output in English. Section labels become \`Shot N (Ns)\` / \`Sub-shot 1 (0-4s)\` etc.`,
  `- Input mostly in Chinese → output in Chinese. Section labels stay \`镜号 N（N秒）\` / \`第一镜头（0-4秒）\` etc.`,
  `- Ambiguous → default to English.`,
  ``,
  `# Output structure`,
  ``,
  `Line 1 — shot header: \`Shot {N} ({total duration}s)\` (or \`镜号{N}（{总时长}秒）\` in Chinese).`,
  `Then 1-3 sub-shots. Each sub-shot must cover: cut type, framing, camera move, angle, character, action (with body detail + face / emotion), and scene.`,
  `Dialogue / SFX / system voice goes on its own line.`,
  ``,
  `# Two acceptable styles (pick per sub-shot)`,
  ``,
  `Style A — compact checklist (best for action-only sub-shots with no dialogue):`,
  `  English:  Sub-shot {1/2/…}: ({start}-{end}s) {cut}+{framing}+{move}+{angle}+{character}+{action} (acting: {tone or "no dialogue"}, {motion intensity}, {facial expression}) + {scene}`,
  `  Chinese:  第{一/二/…}镜头：（{起-止}秒）{切镜方式}+{景别}+{运镜}+{视角}+{人物}+{动作}（「演技」{语气/或"无台词"}、{动作幅度}、{面部表情}）+{场景}`,
  ``,
  `Style B — natural prose (best for sub-shots with dialogue / SFX / layered performance):`,
  `  Sub-shot header on its own line: \`Sub-shot 1 (0-5s)\` (or \`第一镜头（0-5秒）\`).`,
  `  Then a prose paragraph that weaves cut, framing, move, angle, character, action, and scene into one description. No \`+\` joins, no \`Framing: X\` style lists.`,
  `  Dialogue on its own line in straight or curly double quotes. When a non-main character speaks, label the speaker: \`System voice (mechanical, female): "..."\` / \`Narrator: "..."\` (or \`系统语音（机械女声）："..."\` / \`旁白："..."\`).`,
  `  SFX / ambient sound goes in parentheses: \`(SFX: long beep from the walkie-talkie)\` (or \`（音效：对讲机"嘟——"的长音）\`).`,
  ``,
  `Pick A if the sub-shot is purely action with no spoken lines. Pick B if there is dialogue / SFX / system broadcast / layered performance. Different sub-shots in the same output may pick different styles.`,
  ``,
  `# Examples`,
  ``,
  `Example 1 (Style A, English)`,
  `Shot 3 (8s)`,
  `Sub-shot 1: (0-4s) cut in + medium shot + fixed + front + Lin Xia + slowly raises a coffee cup to her lips (acting: murmurs to herself, restrained, slight brow furrow) + window-side booth in a retro café after rain`,
  `Sub-shot 2: (4-8s) quick cut + close-up + push in + over-shoulder + Lin Xia + pupils contract slightly, fixed on the window (acting: no dialogue, shoulders tense, lips set) + same booth, rain streaks on the glass`,
  ``,
  `Example 2 (Style A, Chinese)`,
  `镜号 3（8秒）`,
  `第一镜头：（0-4秒）切入+中景+固定+正拍+林夏+缓慢端起咖啡杯凑近唇边（「演技」低声自语、动作轻柔克制、眉头微蹙）+雨后的复古咖啡馆靠窗卡座`,
  `第二镜头：（4-8秒）快切+特写+推近+过肩+林夏+瞳孔微微收缩盯住窗外（「演技」无台词、肩线绷紧、嘴角僵住）+同一卡座、窗玻璃上有雨痕`,
  ``,
  `Example 3 (Style B, English)`,
  `Shot 6 (10s)`,
  `Sub-shot 1 (0-5s)`,
  `Quick-cut medium fixed shot, framed from behind the instructor. He stands silent for three seconds; his Adam's apple bobs; the room is so quiet the air-conditioning hum is audible. Slowly he lifts his walkie-talkie; his thumb depresses the talk key.`,
  `"Initiate plan B3."`,
  `(SFX: long beep from the walkie-talkie)`,
  `Sub-shot 2 (5-10s)`,
  `Wide overhead shot. The hydraulic pistons under the treadmill base extend; the platform lifts with a metal-on-metal shriek. The floor vibrates.`,
  `System voice (mechanical, female): "Simulating final ascent of Mount Olympus. Slope 45 degrees, oxygen at 9%."`,
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
  `# Hard rules`,
  `1. If total shot duration ≤ 12s, output 1-2 sub-shots; > 12s allows up to 3. Sub-shot time ranges must be contiguous, non-overlapping, and sum to the total duration exactly.`,
  `2. The first sub-shot's cut type defaults to "cut in" / "切入"; subsequent default to "quick cut" / "快切". Only switch to "dissolve / fade / push-in / cross-fade" / "溶解 / 淡入 / 推拉进 / 叠化" when pacing demands it.`,
  `3. Framing pick from {close-up / medium close-up / medium / wide / long shot} — Chinese: {特写 / 近景 / 中景 / 全景 / 远景}. Camera move pick from {fixed / push-pull / pan-tilt / tracking / crane / quick cut} — Chinese: {固定 / 推拉 / 摇移 / 跟拍 / 升降 / 快切}. Angle pick from {front / side / high-angle / low-angle / over-the-shoulder} — Chinese: {正拍 / 侧拍 / 俯拍 / 仰拍 / 过肩}.`,
  `4. Character action must cover three layers simultaneously: the action itself + body detail (Adam's apple bobs, pupils contract, fingers tense, …) + facial expression / emotion. Do not write abstract phrases like "speaks angrily" / "愤怒地说".`,
  `5. Preserve the user's original character names, scene names, key actions, and key lines. Do not rename, do not invent new plot beats.`,
  `6. Output the body only — no Markdown symbols, numbered lists, headings, preamble, conclusion, or explanation.`,
  `7. Do not include quality / style words (4K, HD, cinematic, cyberpunk, …) — downstream applies a project-wide style trailer separately.`,
].join("\n");

function buildUserMessage(input: ExpandRequest): string {
  const lines: string[] = [
    "Here is the raw structured info for one storyboard row. Expand it per the rules above.",
  ];
  if (input.shotNumber) lines.push(`Shot number: ${input.shotNumber}`);
  if (input.durationSec) lines.push(`Duration: ~${input.durationSec}s`);
  if (input.sceneName) lines.push(`Scene: ${input.sceneName}`);
  if (input.characters?.length) {
    lines.push(`Characters: ${input.characters.join(", ")}`);
  }
  if (input.currentPrompt?.trim()) {
    lines.push(`Current video prompt (may be rough): ${input.currentPrompt.trim()}`);
  }

  // Generic columns — whatever the user put in the row (dialogue / movement /
  // style / emotion / …). Keep their column labels so the LLM sees the intent.
  if (input.fields) {
    const entries = Object.entries(input.fields)
      .map(([k, v]) => [k.trim(), typeof v === "string" ? v.trim() : ""] as const)
      .filter(([k, v]) => k && v);
    if (entries.length > 0) {
      lines.push("", "Other row fields:");
      for (const [key, value] of entries) {
        lines.push(`- ${key}: ${value}`);
      }
    }
  }

  lines.push("", "Output only the expanded multi-shot prompt body. No explanation.");
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

// ─── /video-prompt/translate ────────────────────────────
//
// Companion to /expand: bidirectional zh ↔ en translation for the same
// prompt textbox. Frontend detects the source language heuristically
// and tells the model where to go; the model only translates.

const TranslateRequestSchema = z.object({
  prompt: z.string().min(1),
  sourceLang: z.enum(["zh", "en"]),
  targetLang: z.enum(["zh", "en"]),
});

type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

const TRANSLATE_SYSTEM_PROMPT = [
  `You are a translator for short-video storyboard prompts. The text describes camera shots, framing, character action, dialogue, and scene.`,
  ``,
  `# Critical rules`,
  ``,
  `1. **Preserve every \`<mention id="..." type="..." imgUrl="..." [voiceId="..."] [model="..."]>label</mention>\` tag exactly.** Keep all attributes verbatim, and DO NOT translate the inner label — those names are project entity identifiers; translating them would break the badges that reference them. Move each \`<mention>\` tag unchanged into the natural position in the translated sentence.`,
  `2. **Translate only the prose around the tags.** Map storyboard vocabulary to natural equivalents:`,
  `   - 镜号 N ↔ Shot N`,
  `   - 第一镜头 / 第二镜头 ↔ Shot 1 / Shot 2`,
  `   - 切入 ↔ cut in；快切 ↔ quick cut；推拉 ↔ push-pull；跟拍 ↔ tracking shot`,
  `   - 特写 / 近景 / 中景 / 全景 / 远景 ↔ close-up / medium close-up / medium / wide / long shot`,
  `   - 正拍 / 侧拍 / 俯拍 / 仰拍 / 过肩 ↔ front / side / high-angle / low-angle / over-the-shoulder`,
  `   - Time ranges: (0-4秒) ↔ (0-4s)`,
  `3. **Keep the structure.** Preserve line breaks, parenthetical notes, dialogue quotes ("..."), and section labels. Don't reflow paragraphs.`,
  `4. **Output the translated text only.** No explanation, no quotes around the whole output, no markdown headings.`,
].join("\n");

function buildTranslateUserMessage(input: TranslateRequest): string {
  const fromTo =
    input.sourceLang === "zh" && input.targetLang === "en"
      ? "Translate the following text from Chinese (Simplified) to natural, fluent English:"
      : input.sourceLang === "en" && input.targetLang === "zh"
        ? "Translate the following text from English to natural, fluent Simplified Chinese:"
        : `Translate the following text from ${input.sourceLang} to ${input.targetLang}:`;
  return `${fromTo}\n\n${input.prompt}`;
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

  registerApiRoute("/video-prompt/translate", {
    method: "POST",
    handler: async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid JSON body" }, 400);
      }

      const parsed = TranslateRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "invalid input", issues: parsed.error.issues }, 400);
      }

      // No-op when the user picked the same source and target.
      if (parsed.data.sourceLang === parsed.data.targetLang) {
        return c.json({ prompt: parsed.data.prompt });
      }

      try {
        const model = resolveVideoPromptModel();
        const { text } = await generateText({
          model,
          system: TRANSLATE_SYSTEM_PROMPT,
          prompt: buildTranslateUserMessage(parsed.data),
          // Translation should be deterministic-ish; lower than expand.
          temperature: 0.2,
        });

        const cleaned = text.trim();
        if (!cleaned) {
          return c.json({ error: "empty response from model" }, 502);
        }
        return c.json({ prompt: cleaned });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error("[video-prompt/translate] LLM call failed:", message);
        return c.json({ error: `translate failed: ${message}` }, 500);
      }
    },
  }),
];
