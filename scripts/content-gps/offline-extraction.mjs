import { createHash } from "node:crypto";
import {
  ContentGpsMetadataSchema,
  ContentGpsEvidenceSchema,
  ContentGpsPointSchema,
} from "../../packages/shared/dist/content-gps.js";

function fail(message) {
  throw new Error(message);
}
function unique(items, key, label) {
  const result = new Map();
  for (const item of items) {
    if (result.has(item[key])) fail(`Duplicate ${label}`);
    result.set(item[key], item);
  }
  return result;
}
/** Stable source ordering; source text and provenance changes invalidate prior work.
 * This is a fixture harness, not a source authorization service or an AI client.
 */
export function fingerprintSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.sources)) fail("Invalid source snapshot");
  unique(snapshot.sources, "id", "source ID");
  const sources = snapshot.sources
    .map(({ text, ...evidence }) => {
      if (typeof text !== "string" || !text.length) fail("Missing source text");
      return { ...ContentGpsEvidenceSchema.parse(evidence), text };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return createHash("sha256")
    .update(JSON.stringify({ ipId: snapshot.ipId, sources }))
    .digest("hex");
}

/** Validate a recorded extraction against host-owned source and geocoder fixtures.
 * Quote checks prove provenance only, not that an inference is semantically correct.
 * No network, persistence, permissions, retries or billing are implemented here.
 */
export function validateOfflineExtraction({
  snapshot,
  candidate,
  citations,
  geocodes = [],
  existing,
  analysisVersion,
  analyzedAt,
}) {
  const sourceFingerprint = fingerprintSnapshot(snapshot);
  const sources = unique(snapshot.sources, "id", "source ID");
  if (existing) {
    const saved = ContentGpsMetadataSchema.parse(existing);
    if (saved.ipId !== snapshot.ipId) fail("Existing metadata belongs to another IP");
    if (saved.review.status !== "unreviewed")
      return { status: "preserved_review", metadata: saved };
  }
  // Parse first so model-added keys, false review claims and coordinates fail closed.
  const extracted = ContentGpsMetadataSchema.parse(candidate);
  if (extracted.ipId !== snapshot.ipId || extracted.sourceFingerprint !== sourceFingerprint)
    fail("Extraction belongs to a different source snapshot");
  if (
    extracted.analysisVersion !== analysisVersion ||
    extracted.analyzedAt !== analyzedAt ||
    extracted.review.status !== "unreviewed"
  )
    fail("Extraction changed host analysis context");
  if (extracted.locations.some((location) => location.status === "resolved"))
    fail("Extraction cannot supply geocoded coordinates");
  const quotes = unique(citations, "evidenceId", "citation");
  for (const evidence of extracted.evidence) {
    const source = sources.get(evidence.id);
    if (!source) fail("Evidence references an unknown source");
    const { text, ...hostEvidence } = source;
    if (JSON.stringify(ContentGpsEvidenceSchema.parse(hostEvidence)) !== JSON.stringify(evidence))
      fail("Extraction changed source provenance");
    const quote = quotes.get(evidence.id);
    if (
      !quote ||
      !Number.isSafeInteger(quote.start) ||
      !Number.isSafeInteger(quote.end) ||
      quote.start < 0 ||
      quote.end <= quote.start ||
      quote.end > text.length ||
      typeof quote.text !== "string" ||
      text.slice(quote.start, quote.end) !== quote.text
    )
      fail("Citation does not match the source span");
  }
  if (quotes.size !== extracted.evidence.length) fail("Unexpected citation");
  const geocodeById = unique(geocodes, "locationId", "geocode result");
  const locationIds = new Set(extracted.locations.map((location) => location.id));
  for (const result of geocodes) {
    if (!locationIds.has(result.locationId)) fail("Geocode references an unknown location");
    if (result.sourceFingerprint !== sourceFingerprint) fail("Stale geocode result");
  }
  const locations = extracted.locations.map((location) => {
    const result = geocodeById.get(location.id);
    if (!result) return location;
    if (
      location.status !== "unresolved" ||
      result.label !== location.label ||
      result.kind !== location.kind
    )
      fail("Geocode result does not match the extracted location");
    if (!Array.isArray(result.candidates)) fail("Invalid geocode candidates");
    const points = result.candidates.map((point) => ContentGpsPointSchema.parse(point));
    if (points.length === 0) return location;
    if (points.length > 1) return { ...location, status: "ambiguous", point: null };
    return { ...location, status: "resolved", point: points[0] };
  });
  const metadata = ContentGpsMetadataSchema.parse({ ...extracted, locations });
  return { status: "validated_fixture", metadata };
}
