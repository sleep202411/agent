import { describe, expect, it } from "vitest";
import {
  ContentGpsMetadataSchema,
  ContentGpsPointSchema,
  ContentGpsQuerySchema,
} from "./content-gps";
const evidence = {
  id: "e1",
  sourceType: "ip_localization",
  sourceId: "localization-1",
  sourceVersion: "v1",
  locator: "summary",
  visibilityAtAnalysis: "public",
};
const point = {
  latitude: 1.3521,
  longitude: 103.8198,
  coordinateSystem: "WGS84",
  precision: "city",
  provider: "fixture",
  providerPlaceId: null,
};
const location = {
  id: "l1",
  kind: "story_setting",
  label: "Singapore",
  evidenceIds: ["e1"],
  status: "resolved",
  point,
};
const metadata = () => ({
  schemaVersion: 1,
  ipId: "01900000-0000-7000-8000-000000000001",
  sourceFingerprint: "a".repeat(64),
  analysisVersion: "fixture-v1",
  analyzedAt: "2026-10-01T00:00:00Z",
  locationCoverage: "identified",
  locations: [location],
  eras: [],
  evidence: [evidence],
  review: { status: "unreviewed" },
});
const query = () => ({
  schemaVersion: 1,
  locale: "en-US",
  location: { kind: "story_setting", placeIds: ["singapore"], relation: "any" },
  era: {
    calendar: "proleptic_gregorian_astronomical",
    startYear: 1980,
    endYear: 2000,
    relation: "overlaps",
  },
  duration: { unit: "episode", maxSeconds: 900, unknown: "exclude" },
  genreCodes: ["romance"],
  moodPreferences: [],
});
describe("Content GPS preparatory metadata", () => {
  it("preserves the Singapore fixture and source identity", () => {
    expect(ContentGpsMetadataSchema.parse(metadata())).toEqual(metadata());
  });
  it.each(["fictional", "ambiguous", "unresolved"])("keeps %s locations unmapped", (status) => {
    const value = { ...metadata(), locations: [{ ...location, status, point: null }] };
    expect(ContentGpsMetadataSchema.parse(value).locations[0].point).toBeNull();
    expect(
      ContentGpsMetadataSchema.safeParse({ ...value, locations: [{ ...location, status }] }).success
    ).toBe(false);
  });
  it("represents absent location evidence without a manufactured point", () => {
    const value = { ...metadata(), locationCoverage: "unknown", locations: [], evidence: [] };
    expect(ContentGpsMetadataSchema.parse(value).locations).toEqual([]);
    expect(ContentGpsMetadataSchema.safeParse({ ...value, locations: [location] }).success).toBe(
      false
    );
  });
  it("requires locations for identified coverage", () => {
    expect(ContentGpsMetadataSchema.safeParse({ ...metadata(), locations: [] }).success).toBe(
      false
    );
  });
  it.each([
    { latitude: 91 },
    { longitude: -181 },
    { latitude: null },
    { longitude: "103.8198" },
    { coordinateSystem: undefined },
    { precision: undefined },
    { latitude: Infinity },
  ])("rejects invalid or implicit coordinates %j", (patch) => {
    expect(ContentGpsPointSchema.safeParse({ ...point, ...patch }).success).toBe(false);
  });
  it("does not reject a legitimate zero coordinate", () => {
    expect(ContentGpsPointSchema.parse({ ...point, latitude: 0, longitude: 0 }).latitude).toBe(0);
  });
  it("preserves distinct story and production locations", () => {
    const value = {
      ...metadata(),
      locations: [location, { ...location, id: "l2", kind: "production_origin" }],
    };
    expect(ContentGpsMetadataSchema.parse(value).locations).toHaveLength(2);
  });
  it.each([
    { evidence: [] },
    { evidence: [evidence, evidence] },
    { locations: [location, location] },
    { locations: [{ ...location, evidenceIds: [] }] },
    { locations: [{ ...location, evidenceIds: ["missing"] }] },
  ])("rejects broken provenance %j", (patch) => {
    expect(ContentGpsMetadataSchema.safeParse({ ...metadata(), ...patch }).success).toBe(false);
  });
  it("requires actor and timestamp for manual review", () => {
    expect(
      ContentGpsMetadataSchema.safeParse({ ...metadata(), review: { status: "corrected" } }).success
    ).toBe(false);
  });
  it("rejects reversed eras and undeclared fields", () => {
    expect(
      ContentGpsMetadataSchema.safeParse({
        ...metadata(),
        eras: [
          {
            calendar: "proleptic_gregorian_astronomical",
            startYear: 2000,
            endYear: 1980,
            evidenceIds: ["e1"],
          },
        ],
      }).success
    ).toBe(false);
    expect(ContentGpsMetadataSchema.safeParse({ ...metadata(), isPublic: true }).success).toBe(
      false
    );
  });
});
describe("Content GPS explicit query semantics", () => {
  it("represents Pax's sample without executing search", () => {
    expect(ContentGpsQuerySchema.parse(query())).toEqual(query());
  });
  it.each(["kind", "relation"])("requires location %s", (key) => {
    const value = query();
    delete (value.location as Record<string, unknown>)[key];
    expect(ContentGpsQuerySchema.safeParse(value).success).toBe(false);
  });
  it.each(["unit", "unknown"])("requires duration %s", (key) => {
    const value = query();
    delete (value.duration as Record<string, unknown>)[key];
    expect(ContentGpsQuerySchema.safeParse(value).success).toBe(false);
  });
  it.each([0, -1, null, "900", NaN])("rejects invalid duration %j", (maxSeconds) => {
    expect(
      ContentGpsQuerySchema.safeParse({ ...query(), duration: { ...query().duration, maxSeconds } })
        .success
    ).toBe(false);
  });
  it("allows an explicitly unconstrained query", () => {
    expect(
      ContentGpsQuerySchema.parse({ ...query(), location: null, era: null, duration: null })
    ).toMatchObject({ location: null, era: null, duration: null });
  });
  it("requires explicit chronology and interval relation", () => {
    const value = query();
    expect(
      ContentGpsQuerySchema.safeParse({ ...value, era: { ...value.era, relation: undefined } })
        .success
    ).toBe(false);
    expect(
      ContentGpsQuerySchema.safeParse({ ...value, era: { ...value.era, calendar: undefined } })
        .success
    ).toBe(false);
  });
});
