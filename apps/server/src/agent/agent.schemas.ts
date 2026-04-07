import { z } from 'zod';

// ─── Step① Story Outline ────────────────────────────────

export const episodeSchema = z.object({
  title: z.string(),
  summary: z.string(),
  script: z.string(),
});

export const storyOutlineSchema = z.object({
  title: z.string(),
  genre: z.string(),
  background: z.string(),
  conflict: z.string(),
  oneLiner: z.string(),
  videoStyle: z.enum(['3D, CG动画', '2D动画', '写实', '水墨风', '赛博朋克']),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3']),
  episodes: z.array(episodeSchema),
});

export type StoryOutlineResult = z.infer<typeof storyOutlineSchema>;

// ─── Step② Characters & Scenes ──────────────────────────

export const characterSchema = z.object({
  name: z.string(),
  role: z.enum(['main', 'supporting', 'extra']),
  personality: z.string(),
  appearance: z.string(),
});

export const sceneSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const propSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const charactersAndScenesSchema = z.object({
  characters: z.array(characterSchema),
  scenes: z.array(sceneSchema),
  props: z.array(propSchema),
});

export type CharactersAndScenesResult = z.infer<
  typeof charactersAndScenesSchema
>;

// ─── Step③ Storyboard ────────────────────────────────────

export const shotSchema = z.object({
  shotNumber: z.number(),
  timecode: z.string().describe('时间码，如 00:00-00:03'),
  scene: z.string().describe('场景 Scene_ID 或 Slugline'),
  characters: z.string().describe('出场角色，无人物写"无"'),
  costume: z.string().describe('服装，引用场次服装映射').optional(),
  props: z.string().describe('实体道具').optional(),
  shotSize: z.string().describe('景别：ECU/CU/MCU/MS/MLS/LS/ELS'),
  cameraAngle: z.string().describe('角度：Eye Level/Low/High/Dutch/POV/OTS'),
  focalLength: z.string().describe('焦距，如 85mm, 35mm').optional(),
  cameraMovement: z
    .string()
    .describe('运动：Static/Push/Pull/Pan/Track/Crane/Handheld'),
  composition: z.string().describe('构图：三分法/对称/引导线等').optional(),
  description: z.string().describe('画面描述，120-220字，详细到可用于 AI 生成'),
  action: z.string().describe('角色动作，无人物写"静止"'),
  expression: z.string().describe('角色神态，无人物写"无"'),
  dialogue: z.string().describe('台词').optional(),
  narration: z.string().describe('旁白/VO').optional(),
  lighting: z.string().describe('光线，引用 Scene_Lighting').optional(),
  sfx: z.string().describe('音效').optional(),
  narrativeFunction: z.string().describe('叙事功能').optional(),
  imagePrompt: z.string().describe('AI 图片生成提示词'),
  videoPrompt: z.string().describe('AI 视频生成提示词'),
  duration: z.number().describe('时长（秒），3-5秒'),
});

export const episodeStoryboardSchema = z.object({
  episodeTitle: z.string(),
  shots: z.array(shotSchema),
});

export const storyboardSchema = z.object({
  storyboards: z.array(episodeStoryboardSchema),
});

export type StoryboardResult = z.infer<typeof storyboardSchema>;
