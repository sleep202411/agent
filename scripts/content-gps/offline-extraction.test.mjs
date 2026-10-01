import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprintSnapshot, validateOfflineExtraction } from "./offline-extraction.mjs";
function fixture() {
  const snapshot = {
    ipId: "01900000-0000-7000-8000-000000000001",
    sources: [
      {
        id: "e1",
        sourceType: "ip_localization",
        sourceId: "fixture-ip-en",
        sourceVersion: "1",
        locator: "summary",
        visibilityAtAnalysis: "public",
        text: "In 1990, two lovers reunite in Singapore.",
      },
    ],
  };
  const sourceFingerprint = fingerprintSnapshot(snapshot),
    { text, ...evidence } = snapshot.sources[0];
  const analysisVersion = "offline-fixture-1",
    analyzedAt = "2026-10-01T00:00:00Z";
  const candidate = {
    schemaVersion: 1,
    ipId: snapshot.ipId,
    sourceFingerprint,
    analysisVersion,
    analyzedAt,
    locationCoverage: "identified",
    locations: [
      {
        id: "l1",
        kind: "story_setting",
        label: "Singapore",
        status: "unresolved",
        point: null,
        evidenceIds: ["e1"],
      },
    ],
    eras: [
      {
        calendar: "proleptic_gregorian_astronomical",
        startYear: 1990,
        endYear: 1990,
        evidenceIds: ["e1"],
      },
    ],
    evidence: [evidence],
    review: { status: "unreviewed" },
  };
  return {
    snapshot,
    candidate,
    analysisVersion,
    analyzedAt,
    citations: [{ evidenceId: "e1", start: 0, end: text.length, text }],
    geocodes: [
      {
        locationId: "l1",
        label: "Singapore",
        kind: "story_setting",
        sourceFingerprint,
        candidates: [
          {
            latitude: 1.3521,
            longitude: 103.8198,
            coordinateSystem: "WGS84",
            precision: "city",
            provider: "offline-fixture",
            providerPlaceId: "fixture-sg",
          },
        ],
      },
    ],
  };
}
test("validates the recorded Singapore example deterministically", () => {
  const input = fixture();
  const first = validateOfflineExtraction(input);
  assert.deepEqual(validateOfflineExtraction(input), first);
  assert.equal(first.metadata.locations[0].status, "resolved");
});
test("source order does not change fingerprint", () => {
  const { snapshot } = fixture();
  snapshot.sources.push({ ...snapshot.sources[0], id: "e2", sourceId: "second" });
  assert.equal(
    fingerprintSnapshot(snapshot),
    fingerprintSnapshot({ ...snapshot, sources: [...snapshot.sources].reverse() })
  );
});
test("changed text invalidates extraction even when source version was not bumped", () => {
  const input = fixture();
  input.snapshot.sources[0].text += " Changed.";
  assert.throws(() => validateOfflineExtraction(input), /different source snapshot/);
});
test("unknown locations remain absent", () => {
  const input = fixture();
  input.candidate.locations = [];
  input.candidate.locationCoverage = "unknown";
  input.geocodes = [];
  assert.deepEqual(validateOfflineExtraction(input).metadata.locations, []);
});
for (const status of ["fictional", "ambiguous"])
  test(`${status} locations cannot be mapped automatically`, () => {
    const input = fixture();
    input.candidate.locations[0].status = status;
    assert.throws(() => validateOfflineExtraction(input), /does not match/);
    input.geocodes = [];
    assert.equal(validateOfflineExtraction(input).metadata.locations[0].point, null);
  });
test("multiple geocoder candidates remain ambiguous", () => {
  const input = fixture();
  input.geocodes[0].candidates.push({
    ...input.geocodes[0].candidates[0],
    providerPlaceId: "other",
  });
  assert.equal(validateOfflineExtraction(input).metadata.locations[0].status, "ambiguous");
});
test("no geocoder candidates remain unresolved", () => {
  const input = fixture();
  input.geocodes[0].candidates = [];
  assert.equal(validateOfflineExtraction(input).metadata.locations[0].status, "unresolved");
});
for (const [name, mutate, pattern] of [
  ["fabricated quote", (x) => (x.citations[0].text = "Made up"), /source span/],
  ["invalid quote bounds", (x) => (x.citations[0].start = -1), /source span/],
  [
    "forged visibility",
    (x) => (x.candidate.evidence[0].visibilityAtAnalysis = "restricted"),
    /source provenance/,
  ],
  ["stale geocode", (x) => (x.geocodes[0].sourceFingerprint = "a".repeat(64)), /Stale geocode/],
  ["wrong geocode place", (x) => (x.geocodes[0].label = "London"), /does not match/],
  ["wrong geocode kind", (x) => (x.geocodes[0].kind = "production_origin"), /does not match/],
  ["unknown geocode", (x) => (x.geocodes[0].locationId = "other"), /unknown location/],
  ["duplicate geocode", (x) => x.geocodes.push(x.geocodes[0]), /Duplicate/],
  ["duplicate quote", (x) => x.citations.push(x.citations[0]), /Duplicate/],
  [
    "model coordinates",
    (x) => {
      x.candidate.locations[0].status = "resolved";
      x.candidate.locations[0].point = x.geocodes[0].candidates[0];
    },
    /cannot supply/,
  ],
  [
    "model review",
    (x) =>
      (x.candidate.review = { status: "confirmed", reviewerId: "fake", reviewedAt: x.analyzedAt }),
    /host analysis/,
  ],
  ["model version", (x) => (x.candidate.analysisVersion = "other"), /host analysis/],
])
  test(`rejects ${name}`, () => {
    const input = fixture();
    mutate(input);
    assert.throws(() => validateOfflineExtraction(input), pattern);
  });
test("preserves prior manual correction instead of overwriting it", () => {
  const input = fixture();
  const saved = validateOfflineExtraction(input).metadata;
  saved.review = {
    status: "corrected",
    reviewerId: "fixture-reviewer",
    reviewedAt: input.analyzedAt,
  };
  input.snapshot.sources[0].text = "Revised source";
  const result = validateOfflineExtraction({ ...input, existing: saved });
  assert.equal(result.status, "preserved_review");
  assert.deepEqual(result.metadata, saved);
});
test("cannot preserve another IP's review", () => {
  const input = fixture();
  const saved = validateOfflineExtraction(input).metadata;
  saved.ipId = "01900000-0000-7000-8000-000000000002";
  assert.throws(() => validateOfflineExtraction({ ...input, existing: saved }), /another IP/);
});
test("restricted evidence is retained internally and not promoted to public", () => {
  const input = fixture();
  input.snapshot.sources[0].visibilityAtAnalysis = "restricted";
  input.candidate.evidence[0].visibilityAtAnalysis = "restricted";
  const hash = fingerprintSnapshot(input.snapshot);
  input.candidate.sourceFingerprint = hash;
  input.geocodes[0].sourceFingerprint = hash;
  assert.equal(
    validateOfflineExtraction(input).metadata.evidence[0].visibilityAtAnalysis,
    "restricted"
  );
});
