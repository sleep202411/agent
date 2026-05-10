import "server-only";

import type { Course, WithContext } from "schema-dts";

import { absoluteUrl, entityId } from "../canonical";
import { ORGANIZATION_ID } from "./organization";

export interface CourseInput {
  url: string;
  inLanguage: string;
  name: string;
  description: string;
  image?: string;
  /** Lesson count, when known. */
  numberOfLessons?: number;
  /** Set true for free courses. Renders as `offers.price = 0`. */
  free?: boolean;
}

/**
 * schema.org Course — for `/courses/[id]`.
 *
 * `offers` is required by Google for the rich result; we always
 * emit a free `Offer` when `free` is set, else omit the field
 * (don't fabricate a price we don't actually charge — Google flags
 * it as misleading).
 *
 * `provider` references the brand Organization so courses bind
 * back into the FizzDragon entity graph.
 */
export function buildCourse(input: CourseInput): WithContext<Course> {
  const url = absoluteUrl(input.url);
  return {
    "@context": "https://schema.org",
    "@type": "Course",
    "@id": entityId(input.url, "course"),
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    name: input.name,
    description: input.description,
    inLanguage: input.inLanguage,
    provider: { "@id": ORGANIZATION_ID },
    ...(input.image ? { image: absoluteUrl(input.image) } : {}),
    ...(typeof input.numberOfLessons === "number"
      ? { numberOfCredits: input.numberOfLessons }
      : {}),
    ...(input.free
      ? {
          offers: {
            "@type": "Offer",
            price: 0,
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
            category: "Free",
          },
        }
      : {}),
  };
}
