/**
 * All AI model API paths, centralized to avoid duplication across components.
 */

export const AI_MODEL_PATHS = {
  image: "/api/ai/image/generate/basic",
  imageEdit: "/api/ai/image/edit/wan",
  video: "/api/ai/video/generate/basic",
  voice: "/api/ai/voice/synthesize",
  lipSync: "/api/ai/video/lip/sync",
  audio: "/api/ai/audio/generate/basic",
  music: "/api/ai/voice/music",
  characterFusion: "/api/ai/image/compose/character",
  storyboardChat: "/api/ai/chat/storyboard/chat",
} as const;

export type AiModelPath = (typeof AI_MODEL_PATHS)[keyof typeof AI_MODEL_PATHS];

export const ALL_AI_MODEL_PATHS = Object.values(AI_MODEL_PATHS);
