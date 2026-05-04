/**
 * Contract between the /art-studio composer and the downstream project
 * workspace (/projects/:id). A "seed" is the payload the user gave in
 * the hero composer; the composer stashes it in sessionStorage and the
 * workspace picks it up on mount to bootstrap the first StoryOS turn.
 */

export type StudioAgent = "character" | "episode" | "prop" | "scene";

export interface StudioSeedAttachment {
  /** OSS 相对路径（后端拿这个去 OSS 下载） */
  path: string;
  /** 直链（前端可以直接拉显示/下载） */
  url: string;
  /** 原始文件名 */
  name: string;
  /** MIME 类型 */
  mimeType: string;
  /** 字节大小 */
  size: number;
}

export interface StudioSeed {
  agent: StudioAgent;
  prompt: string;
  /** 剧本附件；可选 */
  attachment?: StudioSeedAttachment;
}

// ─── sessionStorage key ────────────────────────────────

export const STUDIO_SEED_STORAGE_KEY = "pendingStudioSeed";
