import { streamObject } from "ai";
import { getModel } from "@/src/lib/ai/provider";
import { getSkill } from "./skill-loader";
import { storyOutlineSchema, charactersAndScenesSchema, storyboardSchema } from "./schemas";

export async function generateOutline(input: { prompt?: string; text?: string }) {
  const isParseMode = !!input.text && input.text.length > 500;
  const skill = getSkill(isParseMode ? "outline-parse" : "outline-create");

  const userMessage = isParseMode
    ? `请分析以下小说/故事文本，提取并改编为影视大纲：\n\n${input.text}`
    : `请根据以下创意生成完整的故事大纲：\n\n${input.prompt}`;

  return streamObject({
    model: getModel(skill.metadata.model),
    schema: storyOutlineSchema,
    system: skill.systemPrompt,
    prompt: userMessage,
    ...(skill.metadata.temperature !== undefined && {
      temperature: skill.metadata.temperature,
    }),
  });
}

export async function generateCharacters(input: {
  outline: {
    title: string;
    background: string;
    conflict: string;
    episodes: { title: string; script: string }[];
  };
}) {
  const skill = getSkill("characters");

  const episodeScripts = input.outline.episodes
    .map((ep, i) => `## 第${i + 1}集：${ep.title}\n${ep.script}`)
    .join("\n\n");

  const userMessage = `请从以下故事大纲和剧本中提取所有角色、场景和道具：

# 故事标题：${input.outline.title}
# 故事背景：${input.outline.background}
# 核心冲突：${input.outline.conflict}

# 剧本内容：
${episodeScripts}`;

  return streamObject({
    model: getModel(skill.metadata.model),
    schema: charactersAndScenesSchema,
    system: skill.systemPrompt,
    prompt: userMessage,
    ...(skill.metadata.temperature !== undefined && {
      temperature: skill.metadata.temperature,
    }),
  });
}

export async function generateStoryboard(input: {
  outline: {
    title: string;
    videoStyle: string;
    aspectRatio: string;
    episodes: { title: string; script: string }[];
  };
  characters: { name: string; appearance: string }[];
  scenes: { name: string; description: string }[];
}) {
  const skill = getSkill("storyboard");

  const characterInfo = input.characters.map((c) => `- ${c.name}：${c.appearance}`).join("\n");
  const sceneInfo = input.scenes.map((s) => `- ${s.name}：${s.description}`).join("\n");
  const episodeScripts = input.outline.episodes
    .map((ep, i) => `## 第${i + 1}集：${ep.title}\n${ep.script}`)
    .join("\n\n");

  const userMessage = `请为以下故事生成分镜表：

# 故事标题：${input.outline.title}
# 视频风格：${input.outline.videoStyle}
# 画面比例：${input.outline.aspectRatio}

# 角色列表（生成画面描述时请融入角色外貌特征）：
${characterInfo}

# 场景列表（生成画面描述时请融入场景视觉特征）：
${sceneInfo}

# 剧本内容：
${episodeScripts}`;

  return streamObject({
    model: getModel(skill.metadata.model),
    schema: storyboardSchema,
    system: skill.systemPrompt,
    prompt: userMessage,
    ...(skill.metadata.temperature !== undefined && {
      temperature: skill.metadata.temperature,
    }),
  });
}
