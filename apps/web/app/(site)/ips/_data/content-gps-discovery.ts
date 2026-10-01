import {
  ContentGpsQuerySchema,
  type ContentGpsQuery,
  type ContentGpsSearchResult,
} from "@repo/shared/content-gps";
import type { GpsMapFeature } from "./content-gps-map-types";

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

/** Selected locations remain separate from aggregates; no coordinate conversion or invented pins. */
export function gpsMapFeatures(
  result: ContentGpsSearchResult,
  clusterLabel: (count: number, matched: boolean) => string
): GpsMapFeature[] {
  const features: GpsMapFeature[] = result.clusters.map((cluster) => ({
    id: `cluster:${cluster.cell}:${cluster.matched}`,
    latitude: cluster.latitude,
    longitude: cluster.longitude,
    coordinateSystem: result.mapScope.coordinateSystem,
    label: clusterLabel(cluster.ipCount, cluster.matched),
    matched: cluster.matched,
    selected: false,
    count: cluster.ipCount,
    entityId: cluster.ipId,
  }));
  const selected = result.selected;
  if (selected)
    for (const location of selected.locations) {
      if (
        location.status !== "resolved" ||
        !location.point ||
        location.point.coordinateSystem !== result.mapScope.coordinateSystem
      )
        continue;
      features.push({
        id: `selected:${selected.id}:${location.id}`,
        latitude: location.point.latitude,
        longitude: location.point.longitude,
        coordinateSystem: location.point.coordinateSystem,
        label: `${selected.title} · ${location.label}`,
        matched: selected.matched,
        selected: true,
        count: 1,
        entityId: selected.id,
      });
    }
  return features;
}
