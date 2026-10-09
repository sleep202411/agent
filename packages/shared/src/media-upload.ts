import { z } from "zod";

/** Shared signed-upload contract. Storage policy remains authoritative on Server. */
export const UploadKindSchema = z.enum([
  "episode_video",
  "episode_source_video",
  "episode_cover",
  "ip_banner",
  "news_cover",
  "workspace_icon",
  "ai_reference_image",
  "agent_attachment_image",
  "agent_attachment_document",
  "ai_reference_video",
  "content_review_video",
  "ai_reference_audio",
  "story_music_audio",
  "crew_asset_file",
]);
export type UploadKind = z.infer<typeof UploadKindSchema>;
