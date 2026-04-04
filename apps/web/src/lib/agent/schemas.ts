import { z } from "zod";

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
  videoStyle: z.enum(["3D, CG动画", "2D动画", "写实", "水墨风", "赛博朋克"]),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3"]),
  episodes: z.array(episodeSchema),
});

export type StoryOutlineResult = z.infer<typeof storyOutlineSchema>;

// ─── Step② Characters & Scenes ──────────────────────────

export const characterSchema = z.object({
  name: z.string(),
  role: z.enum(["main", "supporting", "extra"]),
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

export type CharactersAndScenesResult = z.infer<typeof charactersAndScenesSchema>;

// ─── Step③ Storyboard ────────────────────────────────────

export const shotSchema = z.object({
  shotNumber: z.number(),
  description: z.string(),
  dialogue: z.string(),
  narration: z.string(),
  cameraAngle: z.enum(["全景", "中景", "近景", "特写", "俯拍", "仰拍", "侧面"]),
  cameraMovement: z.enum(["固定", "推", "拉", "摇", "移", "跟", "升", "降"]),
  duration: z.number(),
});

export const episodeStoryboardSchema = z.object({
  episodeTitle: z.string(),
  shots: z.array(shotSchema),
});

export const storyboardSchema = z.object({
  storyboards: z.array(episodeStoryboardSchema),
});

export type StoryboardResult = z.infer<typeof storyboardSchema>;
