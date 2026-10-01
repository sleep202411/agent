import { expect, it } from "vitest";
import type { ContentGpsSearchResult } from "@repo/shared/content-gps";
import {
  EMPTY_GPS_DRAFT,
  gpsDraftFromUrl,
  gpsDraftUrl,
  normalizeGpsDraft,
  gpsDraftFromQuery,
  gpsMapFeatures,
} from "./content-gps-discovery";
it("round trips explicit conditions with the approved story/era/episode defaults", () => {
  const draft = {
    places: ["label:singapore"],
    genres: ["romance"],
    startYear: "1980",
    endYear: "2000",
    maxSeconds: "900",
  };
  expect(gpsDraftFromUrl(new URLSearchParams(gpsDraftUrl(draft)))).toEqual(draft);
  const result = normalizeGpsDraft(draft, "en-US");
  expect(result.success).toBe(true);
  if (!result.success) throw new Error("Expected valid query");
  expect(result.data.location).toEqual({
    kind: "story_setting",
    placeIds: draft.places,
    relation: "any",
  });
  expect(result.data.era).toMatchObject({ relation: "overlaps", startYear: 1980, endYear: 2000 });
  expect(result.data.duration).toEqual({ unit: "episode", maxSeconds: 900, unknown: "exclude" });
  expect(gpsDraftFromQuery(result.data)).toEqual(draft);
});
it.each([
  { startYear: "1980" },
  { endYear: "2000" },
  { startYear: "2000", endYear: "1980" },
  { maxSeconds: "0" },
  { maxSeconds: "1.2" },
  { maxSeconds: "9e2" },
  { maxSeconds: "9007199254740992" },
  { places: [""] },
])("rejects incomplete or silently coercible criteria %j", (change) => {
  expect(normalizeGpsDraft({ ...EMPTY_GPS_DRAFT, ...change }, "en-US").success).toBe(false);
});
it("does not introduce era or duration criteria for an empty search", () => {
  const result = normalizeGpsDraft(EMPTY_GPS_DRAFT, "zh-HK");
  expect(result.success && result.data).toMatchObject({
    locale: "zh-HK",
    era: null,
    duration: null,
    location: null,
  });
});
it("keeps matched/muted aggregates separate and pins only resolved locations in the provider system", () => {
  const result = {
    mapScope: { coordinateSystem: "WGS84" },
    clusters: [true, false].map((matched) => ({
      cell: "1:2",
      matched,
      latitude: 1,
      longitude: 103,
      ipCount: 2,
      ipId: null,
    })),
    selected: {
      id: "ip",
      title: "Story",
      matched: true,
      locations: [
        {
          id: "good",
          label: "Singapore",
          status: "resolved",
          point: { coordinateSystem: "WGS84", latitude: 1, longitude: 103 },
        },
        {
          id: "other-system",
          label: "City",
          status: "resolved",
          point: { coordinateSystem: "GCJ02", latitude: 20, longitude: 110 },
        },
        { id: "fiction", label: "Invented", status: "fictional", point: null },
        { id: "unknown", label: "Unknown", status: "unresolved", point: null },
      ],
    },
  } as unknown as ContentGpsSearchResult;
  const pins = gpsMapFeatures(result, (count, matched) => `${count} ${matched}`);
  expect(pins).toHaveLength(3);
  expect(new Set(pins.map((pin) => pin.id)).size).toBe(3);
  expect(pins.map((pin) => pin.matched)).toEqual([true, false, true]);
  expect(pins[2]).toMatchObject({
    selected: true,
    entityId: "ip",
    label: "Story · Singapore",
    coordinateSystem: "WGS84",
  });
});

it("preserves nondefault assistant criteria through draft and URL without silent relaxation", () => {
  const query = {
    schemaVersion: 1 as const,
    locale: "en-US" as const,
    location: {
      kind: "production_origin" as const,
      placeIds: ["origin:a", "origin:b"],
      relation: "all" as const,
    },
    era: {
      calendar: "proleptic_gregorian_astronomical" as const,
      startYear: 1980,
      endYear: 2000,
      relation: "contained" as const,
    },
    duration: { unit: "episode" as const, maxSeconds: 900, unknown: "include_labelled" as const },
    genreCodes: ["romance"],
    moodPreferences: [],
  };
  const draft = gpsDraftFromQuery(query);
  const restored = gpsDraftFromUrl(new URLSearchParams(gpsDraftUrl(draft)));
  expect(normalizeGpsDraft(restored, "en-US")).toEqual({ success: true, data: query });
});
it("keeps unsupported duration and mood intent visible to validation rather than dropping it", () => {
  const query = {
    schemaVersion: 1 as const,
    locale: "en-US" as const,
    location: null,
    era: null,
    duration: { unit: "film" as const, maxSeconds: 900, unknown: "exclude" as const },
    genreCodes: [],
    moodPreferences: ["calm"],
  };
  const result = normalizeGpsDraft(
    gpsDraftFromUrl(new URLSearchParams(gpsDraftUrl(gpsDraftFromQuery(query)))),
    "en-US"
  );
  expect(result).toEqual({ success: true, data: query });
});
