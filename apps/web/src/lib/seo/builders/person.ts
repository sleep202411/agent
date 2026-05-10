import "server-only";

import type { Person, WithContext } from "schema-dts";

import { absoluteUrl, entityId } from "../canonical";
import { ORGANIZATION_ID } from "./organization";

export interface PersonInput {
  url: string;
  name: string;
  /** Profession label — "Animator", "Storyboard Artist", … */
  jobTitle?: string;
  /** 1–2 sentence bio. */
  description?: string;
  image?: string;
  /** External profile / portfolio links. */
  sameAs?: string[];
}

/**
 * schema.org Person — for creator profiles `/creators/[id]`.
 *
 * `worksFor` references the brand Organization, anchoring creators
 * into the FizzDragon entity graph. Real-world this is "loose
 * affiliation" rather than employment, but worksFor is the closest
 * schema.org has and AI engines treat it as a soft "associated with"
 * signal — exactly the brand reinforcement we want.
 */
export function buildPerson(input: PersonInput): WithContext<Person> {
  const url = absoluteUrl(input.url);
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": entityId(input.url, "person"),
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    name: input.name,
    ...(input.jobTitle ? { jobTitle: input.jobTitle } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.image ? { image: absoluteUrl(input.image) } : {}),
    ...(input.sameAs && input.sameAs.length > 0 ? { sameAs: input.sameAs } : {}),
    worksFor: { "@id": ORGANIZATION_ID },
  };
}
