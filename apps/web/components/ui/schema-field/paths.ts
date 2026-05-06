/**
 * All AI model API paths, centralized to avoid duplication across components.
 */

export const AI_MODEL_PATHS = {
  // Image
  image: "/api/ai/image/generate/basic",
  imageEdit: "/api/ai/image/edit/wan",
  characterFusion: "/api/ai/image/compose/character",
  // Video
  video: "/api/ai/task/video/generate/basic",
  /** Sync variant — Java holds the connection and returns the video
   *  path inline. Used by the per-episode produce editor; same model
   *  registry as the async task path but registered as its own key
   *  so we don't conflate model availability between the two. */
  videoSync: "/api/ai/video/generate/basic",
  videoFrames: "/api/ai/task/video/generate/start-end-frame",
  videoMultiRef: "/api/ai/task/video/generate/multiplereference",
  videoMultimodal: "/api/ai/task/video/generate/multimodalvideo",
  videoRepaint: "/api/ai/task/video/generate/videorepainting",
  videoLocalEdit: "/api/ai/task/video/generate/videoedit",
  videoExtend: "/api/ai/task/video/generate/videoextension",
  videoOutpaint: "/api/ai/task/video/generate/videooutpainting",
  // Audio
  voice: "/api/ai/voice/synthesize",
  lipSync: "/api/ai/video/lip/sync",
  audio: "/api/ai/audio/generate/basic",
  music: "/api/ai/voice/music",
  // Chat
  storyboardChat: "/api/ai/chat/storyboard/chat",
} as const;

export type AiModelPath = (typeof AI_MODEL_PATHS)[keyof typeof AI_MODEL_PATHS];

export const ALL_AI_MODEL_PATHS = Object.values(AI_MODEL_PATHS);
