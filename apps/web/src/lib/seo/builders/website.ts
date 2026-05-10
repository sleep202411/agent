import "server-only";

import type { WebSite, WithContext } from "schema-dts";

import { CANONICAL_HOST, FRAGMENTS, entityId } from "../canonical";
import { ORGANIZATION_ID } from "./organization";

export const WEBSITE_ID = entityId("/", FRAGMENTS.website);

/**
 * schema.org WebSite for fizzdragon.com.
 *
 * Why we ship a SearchAction:
 *   When Google trusts the SearchAction declaration it renders a
 *   sitelinks search box directly in the SERP — users can search
 *   the FizzDragon catalogue without leaving Google. This requires
 *   our site to actually expose a search URL pattern; for now we
 *   wire `/ips?search={query}` since IP plaza already accepts a
 *   query param. Update the `target` field whenever search routing
 *   changes.
 *
 * Why publisher references the Organization @id:
 *   Cross-document linking via @id keeps the entity graph
 *   deduplicated — bots already know the Organization from the same
 *   page, so we don't need to re-inline it.
 */
export function buildWebSite(): WithContext<WebSite> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: CANONICAL_HOST,
    name: "FizzDragon",
    description: "AI Animation & IP Co-creation Platform",
    publisher: { "@id": ORGANIZATION_ID },
    inLanguage: ["en-US", "zh-CN", "zh-HK"],
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${CANONICAL_HOST}/ips?search={search_term_string}`,
      },
      // schema-dts doesn't expose the legacy `query-input` literal
      // form Google still requires, so we widen via assertion.
      "query-input": "required name=search_term_string",
    } as unknown as WebSite["potentialAction"],
  };
}
