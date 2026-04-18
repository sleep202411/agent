/**
 * Contract between /studio composer and the downstream project workspace
 * (/projects/:id). A "seed" is the payload the user gave in the hero
 * composer — it's carried via postMessage → sessionStorage → postMessage,
 * and consumed once by /projects/:id to bootstrap the first StoryOS turn.
 *
 * All layers (Next.js /studio, fizzdragon-web creatorCenter + workspace,
 * Next.js /projects/:id) must agree on these shapes.
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

// ─── postMessage 协议 ──────────────────────────────────

/** /studio → parent(iframe host)：请求打开项目 */
export interface OpenProjectMessage {
  type: "openProject";
  projectId: string;
  worldId: string;
  seed: StudioSeed;
}

/** /projects/:id → parent(iframe host)：问它有没有为本次跳转暂存的 seed */
export interface RequestSeedMessage {
  type: "requestSeed";
}

/** parent → /projects/:id：回传 seed（没有就 payload: null） */
export interface SeedMessage {
  type: "seed";
  payload: StudioSeed | null;
}

// ─── sessionStorage key ────────────────────────────────

export const STUDIO_SEED_STORAGE_KEY = "pendingStudioSeed";
