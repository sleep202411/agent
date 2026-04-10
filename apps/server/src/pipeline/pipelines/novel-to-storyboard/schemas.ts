import { z } from 'zod';

// ── Step: Analyze (global understanding) ──

export const characterInfoSchema = z.object({
  name: z.string().describe('Character name'),
  aliases: z.array(z.string()).describe('Aliases and nicknames'),
  role: z
    .enum(['main', 'supporting', 'extra'])
    .describe('main/supporting/extra'),
  description: z
    .string()
    .describe(
      'Character biography: background, personality, story role, relationships. Under 80 words.',
    ),
  prompt: z
    .string()
    .describe(
      'AI image generation prompt — pure visual appearance ONLY: facial features, hairstyle, clothing, expression, body type, art style. Under 40 words. Must NOT repeat biography.',
    ),
  relationships: z
    .string()
    .describe('Relationships with other characters')
    .optional(),
});

export const locationInfoSchema = z.object({
  name: z.string().describe('Location name'),
  description: z
    .string()
    .describe(
      'Scene description: narrative function, mood, what happens here. Under 40 words.',
    ),
  prompt: z
    .string()
    .describe(
      'AI image generation prompt — pure visual ONLY: spatial layout, lighting, colors, objects, atmosphere, art style. Under 40 words. Must NOT repeat description.',
    ),
});

export const chapterOutlineSchema = z.object({
  index: z.number(),
  title: z.string(),
  summary: z.string().describe('One-sentence summary of the chapter'),
});

export const analyzeResultSchema = z.object({
  characters: z.array(characterInfoSchema),
  locations: z.array(locationInfoSchema),
  outline: z.array(chapterOutlineSchema),
  style: z
    .string()
    .describe('Genre: realistic/fantasy/sci-fi/wuxia/romance/mystery etc.'),
  timePeriod: z.string().describe('Story time period/era').optional(),
  language: z
    .string()
    .describe(
      'Primary language of the source text, e.g. "English", "Chinese", "Japanese"',
    ),
});

export type AnalyzeResult = z.infer<typeof analyzeResultSchema>;

// ── Step: Scenes (scene extraction per chapter range) ──

export const sceneInfoSchema = z.object({
  index: z.number().describe('Global scene index'),
  title: z.string().describe('Scene title, under 10 words'),
  summary: z.string().describe('Scene content summary, under 50 words'),
  characters: z
    .array(z.string())
    .describe('Character names appearing in this scene'),
  location: z.string().describe('Scene location'),
  startText: z
    .string()
    .describe(
      'First 30 characters of the scene in source text, for positioning',
    ),
  mood: z.string().describe('Mood: tense/warm/sad/joyful/mysterious etc.'),
});

export const scenesResultSchema = z.object({
  scenes: z.array(sceneInfoSchema),
});

export type ScenesResult = z.infer<typeof scenesResultSchema>;

// ── Step: Refine (per-scene shot breakdown) ──

export const shotInfoSchema = z.object({
  shotNumber: z.number(),
  description: z
    .string()
    .describe(
      'Visual description, 100-200 words, detailed enough for AI image generation',
    ),
  dialogue: z.string().describe('Character dialogue, empty if none').optional(),
  narration: z
    .string()
    .describe('Narration/voiceover, empty if none')
    .optional(),
  shotSize: z.string().describe('Shot size: CU/MCU/MS/MLS/LS/ELS'),
  cameraMovement: z
    .string()
    .describe('Camera movement: static/push/pull/pan/track/crane/handheld'),
  duration: z.number().describe('Duration in seconds, 2-5s'),
  imagePrompt: z
    .string()
    .describe(
      'AI image generation prompt — use the output language specified by user',
    ),
  videoPrompt: z
    .string()
    .describe(
      'AI video generation prompt — use the output language specified by user',
    ),
});

export const refineResultSchema = z.object({
  sceneIndex: z.number(),
  sceneTitle: z.string(),
  shots: z.array(shotInfoSchema),
});

export type RefineResult = z.infer<typeof refineResultSchema>;
