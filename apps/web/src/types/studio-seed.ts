/**
 * Contract between the /art-studio composer and the downstream project
 * workspace (/projects/:id). A "seed" is the payload the user gave in
 * the hero composer; the composer stashes it in sessionStorage and the
 * workspace picks it up on mount to bootstrap the first StoryOS turn.
 */

export type StudioAgent =
  | "character"
  | "episode"
  | "prop"
  | "scene"
  | "scriptwriter"
  | "storyboard";

export interface StudioSeedAttachment {
  /** Server text-cache ref (`att_xxx`) from `/aurora/assistant/upload-attachment`.
   *  The workspace embeds it in the first chat message; the Nest
   *  preprocessor resolves it to the extracted full text. */
  ref: string;
  /** 原始文件名 */
  name: string;
  /** MIME 类型 */
  mimeType: string;
  /** 字节大小 */
  size: number;
  /** Short preview of the extracted text for the file card UI. */
  excerpt?: string;
}

export interface StudioSeed {
  /** Pinned persona from the chip rail. `null` means the user didn't
   *  pick one — workspace lets the supervisor route freely instead of
   *  pinning a forced persona, so a casual "你好" doesn't get prefixed
   *  with "角色设计师 / "向 character_designer hard-routed. */
  agent: StudioAgent | null;
  prompt: string;
  /** 剧本附件；可选 */
  attachment?: StudioSeedAttachment;
}

// ─── sessionStorage key ────────────────────────────────

export const STUDIO_SEED_STORAGE_KEY = "pendingStudioSeed";
