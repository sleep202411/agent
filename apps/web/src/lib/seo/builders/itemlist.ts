import "server-only";

import type { ItemList, WithContext } from "schema-dts";

import { absoluteUrl, entityId } from "../canonical";

export interface ItemListEntry {
  /** Item URL (path or absolute). */
  url: string;
  /** Display name in the list. */
  name: string;
  /** Optional thumbnail. */
  image?: string;
}

/**
 * schema.org ItemList — for plaza grids (IP plaza, Crews plaza,
 * Talent market). Tells crawlers + AI engines "this page enumerates
 * a discrete set of items, here are the canonical URLs"; AI engines
 * use the list to navigate into individual items rather than
 * scraping HTML.
 *
 * Limit: cap at 100 items per list. Beyond that ranking gain
 * plateaus and the structured data starts to dominate page weight.
 * If the plaza has more, page it (one ItemList per page slice).
 */
export function buildItemList(
  /** Page URL (path or absolute) — used for the @id. */
  pageUrl: string,
  items: ItemListEntry[]
): WithContext<ItemList> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": entityId(pageUrl, "list"),
    url: absoluteUrl(pageUrl),
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: absoluteUrl(it.url),
      name: it.name,
      ...(it.image ? { image: absoluteUrl(it.image) } : {}),
    })),
  };
}
