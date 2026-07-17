const MiB = 1024 * 1024;

/**
 * Story clip completion streams the confirmed object through this server for
 * checksum + ffprobe. Keep this substantially below long-form episode media so
 * one request cannot monopolize a connection or the local spool volume.
 */
export const STORY_CLIP_VIDEO_MAX_BYTES = 512 * MiB;

/** Launch/runtime contract: every player target can decode MP4/H.264 + AAC. */
export const STORY_CLIP_VIDEO_CONTENT_TYPE = 'video/mp4' as const;
