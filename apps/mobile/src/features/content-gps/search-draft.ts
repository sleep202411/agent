import {
  ContentGpsQuerySchema,
  ContentGpsSearchRequestSchema,
  type ContentGpsQuery,
} from "@repo/shared/content-gps";

export type GpsSearchDraft = {
  places: string[];
  startYear: string;
  endYear: string;
  maxSeconds: string;
  genres: string[];
  locationKind?: string;
  locationRelation?: string;
  eraRelation?: string;
  durationUnit?: string;
  unknownDuration?: string;
  moods?: string[];
};
export const EMPTY_GPS_DRAFT: GpsSearchDraft = {
  places: [],
  startYear: "",
  endYear: "",
  maxSeconds: "",
  genres: [],
};
export function gpsDraftFromUrl(params: URLSearchParams): GpsSearchDraft {
  return {
    places: params.getAll("place"),
    genres: params.getAll("genre"),
    startYear: params.get("from") ?? "",
    endYear: params.get("to") ?? "",
    maxSeconds: params.get("seconds") ?? "",
    ...Object.fromEntries(
      ["locationKind", "locationRelation", "eraRelation", "durationUnit", "unknownDuration"]
        .filter((key) => params.has(key))
        .map((key) => [key, params.get(key)!])
    ),
    ...(params.has("mood") ? { moods: params.getAll("mood") } : {}),
  };
}
export function gpsDraftUrl(draft: GpsSearchDraft): string {
  const params = new URLSearchParams();
  for (const value of draft.places) params.append("place", value);
  for (const value of draft.genres) params.append("genre", value);
  if (draft.startYear) params.set("from", draft.startYear);
  if (draft.endYear) params.set("to", draft.endYear);
  if (draft.maxSeconds) params.set("seconds", draft.maxSeconds);
  for (const key of [
    "locationKind",
    "locationRelation",
    "eraRelation",
    "durationUnit",
    "unknownDuration",
  ] as const)
    if (draft[key] !== undefined) params.set(key, draft[key]);
  for (const mood of draft.moods ?? []) params.append("mood", mood);
  return params.toString();
}
export function normalizeGpsDraft(draft: GpsSearchDraft, locale: string) {
  const integer = (value: string) => (/^-?\d+$/.test(value) ? Number(value) : NaN);
  return ContentGpsQuerySchema.safeParse({
    schemaVersion: 1,
    locale,
    location: draft.places.length
      ? {
          kind: draft.locationKind ?? "story_setting",
          placeIds: [...new Set(draft.places)],
          relation: draft.locationRelation ?? "any",
        }
      : null,
    era:
      draft.startYear || draft.endYear
        ? {
            calendar: "proleptic_gregorian_astronomical",
            startYear: integer(draft.startYear),
            endYear: integer(draft.endYear),
            relation: draft.eraRelation ?? "overlaps",
          }
        : null,
    duration: draft.maxSeconds
      ? {
          unit: draft.durationUnit ?? "episode",
          maxSeconds: integer(draft.maxSeconds),
          unknown: draft.unknownDuration ?? "exclude",
        }
      : null,
    genreCodes: [...new Set(draft.genres)],
    moodPreferences: draft.moods ?? [],
  });
}
export function gpsDraftFromQuery(query: ContentGpsQuery): GpsSearchDraft {
  return {
    places: query.location?.placeIds ?? [],
    genres: query.genreCodes,
    startYear: query.era ? String(query.era.startYear) : "",
    endYear: query.era ? String(query.era.endYear) : "",
    maxSeconds: query.duration ? String(query.duration.maxSeconds) : "",
    ...(query.location && query.location.kind !== "story_setting"
      ? { locationKind: query.location.kind }
      : {}),
    ...(query.location && query.location.relation !== "any"
      ? { locationRelation: query.location.relation }
      : {}),
    ...(query.era && query.era.relation !== "overlaps" ? { eraRelation: query.era.relation } : {}),
    ...(query.duration && query.duration.unit !== "episode"
      ? { durationUnit: query.duration.unit }
      : {}),
    ...(query.duration && query.duration.unknown !== "exclude"
      ? { unknownDuration: query.duration.unknown }
      : {}),
    ...(query.moodPreferences.length ? { moods: query.moodPreferences } : {}),
  };
}

export const gpsLinkKeys = [
  "place",
  "genre",
  "mood",
  "from",
  "to",
  "seconds",
  "locationKind",
  "locationRelation",
  "eraRelation",
  "durationUnit",
  "unknownDuration",
  "selected",
];
export function readGpsLink(input: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  let invalid = false;
  for (const key of gpsLinkKeys) {
    const values = input[key];
    if (Array.isArray(values)) {
      if (!["place", "genre", "mood"].includes(key)) invalid = true;
      values.forEach((v) => params.append(key, v));
    } else if (values) params.set(key, values);
  }
  const selection = ContentGpsSearchRequestSchema.shape.selectedIpId.safeParse(
    params.get("selected")
  );
  return {
    draft: gpsDraftFromUrl(params),
    selected: selection.success ? selection.data : null,
    invalid: invalid || !selection.success,
  };
}
