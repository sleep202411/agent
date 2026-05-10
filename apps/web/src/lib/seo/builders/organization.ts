import "server-only";

import type { Organization, WithContext } from "schema-dts";

import { CANONICAL_HOST, FRAGMENTS, entityId } from "../canonical";

/** Canonical @id for the FizzDragon Organization entity. Other
 *  builders reference this @id (Article.publisher, CreativeWork.creator
 *  etc.) so the structured-data graph stays deduplicated. */
export const ORGANIZATION_ID = entityId("/", FRAGMENTS.organization);

/**
 * schema.org Organization for the FizzDragon brand.
 *
 * Goes in the root layout so every page on every deployment carries
 * it. Bumping this is a brand-level decision — co-ordinate with
 * marketing before changing `name` / `description` / `sameAs`.
 *
 * `sameAs` matters for entity disambiguation:
 *   When AI engines resolve "FizzDragon" they cross-reference the
 *   listed social / press / professional URLs to confirm they're
 *   talking about the same entity. More verified sameAs links →
 *   higher confidence the AI engine attributes IPs / news to us.
 *   Only list URLs we actually control — dead/unverified links
 *   erode trust signals rather than build them.
 */
export function buildOrganization(): WithContext<Organization> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: "FizzDragon",
    alternateName: ["气泡龙", "FizzDragon Pte Ltd"],
    url: CANONICAL_HOST,
    logo: `${CANONICAL_HOST}/logo.png`,
    description:
      "FizzDragon is an AI animation and IP co-creation platform — script to storyboard to render, with a creator marketplace and IP plaza.",
    sameAs: [
      // CN mirror of the same brand. Listing it here tells search
      // engines they're the same entity, not separate companies.
      "https://fizzdragon.fizzspace.cn",
      // Add verified social profiles as they go live.
    ],
    address: {
      "@type": "PostalAddress",
      addressCountry: "SG",
    },
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "business@fizzdragon.com",
        areaServed: ["Worldwide"],
        availableLanguage: ["English", "zh-Hans", "zh-Hant"],
      },
    ],
  };
}
