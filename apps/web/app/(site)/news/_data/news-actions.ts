"use server";

import { getNewsList } from "./news";
import type { NewsItem } from "./types";

/**
 * Server action backing the news feed's tag filter. The client calls this when
 * the user switches to a real tag so filtering is backend-driven
 * (`GET /api/news?tag=…`) rather than in-memory. The "All" pill is handled
 * client-side (it restores the server-rendered list) and never reaches here.
 */
export async function fetchNewsByTag(rawLang: string, tag: string): Promise<NewsItem[]> {
  return getNewsList(rawLang, tag);
}
