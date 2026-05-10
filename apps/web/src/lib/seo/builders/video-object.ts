import "server-only";

import type { VideoObject, WithContext } from "schema-dts";

import { absoluteUrl, entityId } from "../canonical";
import { ORGANIZATION_ID } from "./organization";

export interface VideoObjectInput {
  url: string;
  inLanguage: string;
  /** Display title. */
  name: string;
  description: string;
  /** Thumbnail / poster image (absolute URL recommended for social previews). */
  thumbnailUrl: string;
  /** Direct media file URL — OSS / CDN. Required for Google Video rich result. */
  contentUrl: string;
  /** ISO 8601 duration like `PT1M30S`. Optional; recommended for video carousels. */
  duration?: string;
  /** ISO date the video was uploaded. */
  uploadDate: string;
  /** Optional embed page URL (e.g. our IP detail page that hosts the player). */
  embedUrl?: string;
}

/**
 * schema.org VideoObject — for AI-generated trailers / shorts that
 * we want indexable as videos on Google / Bing / YouTube-style AI
 * crawlers.
 *
 * Distinct from CreativeWork.trailer (an inline VideoObject inside
 * the IP entity): this builder is for *standalone* video pages
 * where the video is the page's primary entity.
 */
export function buildVideoObject(input: VideoObjectInput): WithContext<VideoObject> {
  const url = absoluteUrl(input.url);
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "@id": entityId(input.url, "video"),
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    name: input.name,
    description: input.description,
    inLanguage: input.inLanguage,
    thumbnailUrl: absoluteUrl(input.thumbnailUrl),
    contentUrl: absoluteUrl(input.contentUrl),
    uploadDate: input.uploadDate,
    publisher: { "@id": ORGANIZATION_ID },
    ...(input.duration ? { duration: input.duration } : {}),
    ...(input.embedUrl ? { embedUrl: absoluteUrl(input.embedUrl) } : {}),
  };
}
