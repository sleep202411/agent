import {
  CreatorDiscoveryQuerySchema,
  type CreatorDiscoveryRequest,
} from "@repo/shared/creator-location";

export type StudioDiscoveryDraft = {
  location: string;
  text: string;
  category: string;
  basedCountry: string;
  basedCity: string;
  servesCountry: string;
  servesCity: string;
  remote: string;
  available: string;
};
export const EMPTY_STUDIO_QUERY: StudioDiscoveryDraft = {
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
export function studioDraftFromUrl(params: URLSearchParams): StudioDiscoveryDraft {
  return Object.fromEntries(
    Object.keys(EMPTY_STUDIO_QUERY).map((key) => [key, params.get(key) ?? ""])
  ) as StudioDiscoveryDraft;
}
export function normalizeStudioQuery(draft: StudioDiscoveryDraft) {
  const city = (countryCode: string, name: string) =>
    countryCode.trim() || name.trim()
      ? { countryCode: countryCode.trim().toUpperCase(), city: name.trim() }
      : null;
  // Unrecognized URL boolean values must not silently relax the query.
  const bool = (value: string) => (value === "1" ? true : value === "" ? false : value);
  return CreatorDiscoveryQuerySchema.safeParse({
    ...(draft.location ? { islandOnly: draft.location === "island" ? true : draft.location } : {}),
    text: draft.text,
    category: draft.category || null,
    basedIn: city(draft.basedCountry, draft.basedCity),
    serves: city(draft.servesCountry, draft.servesCity),
    remoteOnly: bool(draft.remote),
    availableForWork: bool(draft.available),
  });
}
export function studioQueryUrl(draft: StudioDiscoveryDraft) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(draft)) if (value.trim()) params.set(key, value.trim());
  return params.toString();
}

export function studioDraftFromQuery(
  query: CreatorDiscoveryRequest["query"]
): StudioDiscoveryDraft {
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
