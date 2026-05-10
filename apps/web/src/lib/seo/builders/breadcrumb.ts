import "server-only";

import type { BreadcrumbList, WithContext } from "schema-dts";

import { absoluteUrl } from "../canonical";

export interface BreadcrumbCrumb {
  /** Human-readable name shown in the search-result trail. */
  name: string;
  /** Page URL — relative paths are resolved against the canonical host. */
  url: string;
}

/**
 * schema.org BreadcrumbList for a single page's navigation trail.
 *
 * Google treats this as the source of truth for the breadcrumb
 * displayed in search results — accurate trails increase CTR by
 * surfacing site structure right inline with the snippet. AI
 * engines also use it to scope their "what is this page" answer.
 *
 * Required: at least 2 crumbs (otherwise there's no trail).
 * Convention: home/section first, current page last.
 */
export function buildBreadcrumbList(crumbs: BreadcrumbCrumb[]): WithContext<BreadcrumbList> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.url),
    })),
  };
}
