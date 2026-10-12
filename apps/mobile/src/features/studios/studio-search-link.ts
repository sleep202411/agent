import {
  CreatorDiscoveryRequestSchema,
  CreatorDiscoveryQuerySchema,
} from "@repo/shared/creator-location";
import type { StudioQuery } from "./studio-search-api";
export const emptyStudioDraft = {
  location: "",
  text: "",
  category: "",
  basedCountry: "",
  basedCity: "",
  servesCountry: "",
  servesCity: "",
  remote: "",
  available: "",
};
export type StudioDraft = typeof emptyStudioDraft;
export const studioLinkKeys = [...Object.keys(emptyStudioDraft), "selected"];
export function parseStudioDraft(draft: StudioDraft) {
  const place = (country: string, city: string) =>
    country.trim() || city.trim()
      ? { countryCode: country.trim().toUpperCase(), city: city.trim() }
      : null;
  const flag = (value: string) => (value === "1" ? true : value === "" ? false : value);
  return CreatorDiscoveryQuerySchema.safeParse({
    ...(draft.location ? { islandOnly: draft.location === "island" ? true : draft.location } : {}),
    text: draft.text,
    category: draft.category || null,
    basedIn: place(draft.basedCountry, draft.basedCity),
    serves: place(draft.servesCountry, draft.servesCity),
    remoteOnly: flag(draft.remote),
    availableForWork: flag(draft.available),
  });
}
export function studioDraftFromQuery(query: StudioQuery): StudioDraft {
  return {
    location: query.islandOnly ? "island" : "",
    text: query.text,
    category: query.category ?? "",
    basedCountry: query.basedIn?.countryCode ?? "",
    basedCity: query.basedIn?.city ?? "",
    servesCountry: query.serves?.countryCode ?? "",
    servesCity: query.serves?.city ?? "",
    remote: query.remoteOnly ? "1" : "",
    available: query.availableForWork ? "1" : "",
  };
}
export function readStudioLink(params: Record<string, string | string[] | undefined>) {
  const repeated = studioLinkKeys.some((key) => Array.isArray(params[key]));
  const draft = Object.fromEntries(
    Object.keys(emptyStudioDraft).map((key) => [
      key,
      typeof params[key] === "string" ? params[key] : "",
    ])
  ) as StudioDraft;
  const selection = CreatorDiscoveryRequestSchema.shape.selectedCreatorId.safeParse(
    params.selected || null
  );
  return {
    draft,
    selected: selection.success ? selection.data : null,
    invalid: repeated || !selection.success,
  };
}
/** Set every supported key so removing a filter cannot leave stale URL conditions. */
export function studioLinkParams(query: StudioQuery, selected: string | null = null) {
  return { ...studioDraftFromQuery(query), selected: selected ?? "" };
}
/** Normalize official regional Web/app links only; preserve unknown callbacks and their context. */
export function redirectStudioSearch(
  path: string,
  region: "global" | "cn",
  schemes: readonly string[]
) {
  try {
    if (path.includes("\\") || path.startsWith("//")) return path;
    let route = path;
    if (!path.startsWith("/")) {
      const url = new URL(path);
      if (url.username || url.password || url.port || url.hash) return path;
      const origin = region === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
      if (url.origin === origin) route = url.pathname + url.search;
      else if (schemes.includes(url.protocol.slice(0, -1)))
        route = `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}${url.search}`;
      else return path;
    }
    const match = /^\/(?:en-US\/|zh-CN\/|zh-HK\/)?(?:creators\/)?studios\/?(\?[^#]*)?$/.exec(route);
    return match ? `/studios${match[1] ?? ""}` : path;
  } catch {
    return path;
  }
}
