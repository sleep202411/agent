import "server-only";

import type { CreativeWork, WithContext } from "schema-dts";

import { absoluteUrl, entityId } from "../canonical";
import { ORGANIZATION_ID } from "./organization";

export interface CreativeWorkInput {
  /** Page URL (path or absolute). */
  url: string;
  /** BCP-47 language tag. */
  inLanguage: string;
  /** Display name of the IP / work. */
  name: string;
  /** 1–3 sentence pitch. Plain text. */
  description: string;
  /** Cover / hero image URL. */
  image: string;
  /** Genre tags — "AI Animation", "Sci-Fi", "Mythology", … */
  genre?: string[];
  /** ISO date the work was first surfaced on the platform. */
  datePublished?: string;
  /** Optional creator details (the human / studio behind the IP).
   *  When omitted we attribute to FizzDragon as creator. */
  creator?: {
    name: string;
    url?: string;
    image?: string;
  };
  /** Trailer / first-shot video URL on OSS, if any. */
  trailerUrl?: string;
  /** Public episode count, when meaningful. */
  numberOfEpisodes?: number;
}

/**
 * schema.org CreativeWork for an IP / story published on FizzDragon.
 *
 * Used on `/ips/[id]` detail pages. CreativeWork is the most
 * generic type — for narrower fits we can later switch to
 * `TVSeries` / `Movie` / `VideoObject` per IP genre, but starting
 * with CreativeWork keeps coverage broad without false-positive
 * type promises that don't hold for every IP.
 *
 * Why creator falls back to Organization @id:
 *   When the IP has no real human creator (platform-incubated /
 *   anonymous), still surfacing FizzDragon as creator binds the
 *   work into the brand graph for GEO purposes.
 */
export function buildCreativeWork(input: CreativeWorkInput): WithContext<CreativeWork> {
  const workUrl = absoluteUrl(input.url);
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "@id": entityId(input.url, "work"),
    url: workUrl,
    mainEntityOfPage: { "@type": "WebPage", "@id": workUrl },
    name: input.name,
    description: input.description,
    image: absoluteUrl(input.image),
    inLanguage: input.inLanguage,
    publisher: { "@id": ORGANIZATION_ID },
    creator: input.creator
      ? {
          "@type": "Person",
          name: input.creator.name,
          ...(input.creator.url ? { url: absoluteUrl(input.creator.url) } : {}),
          ...(input.creator.image ? { image: absoluteUrl(input.creator.image) } : {}),
        }
      : { "@id": ORGANIZATION_ID },
    ...(input.genre && input.genre.length > 0 ? { genre: input.genre } : {}),
    ...(input.datePublished ? { datePublished: input.datePublished } : {}),
    ...(input.trailerUrl
      ? {
          trailer: {
            "@type": "VideoObject",
            name: `${input.name} — Trailer`,
            contentUrl: absoluteUrl(input.trailerUrl),
            thumbnailUrl: absoluteUrl(input.image),
          },
        }
      : {}),
    ...(typeof input.numberOfEpisodes === "number"
      ? { numberOfEpisodes: input.numberOfEpisodes }
      : {}),
  };
}
