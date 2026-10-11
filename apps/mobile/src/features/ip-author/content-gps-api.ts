import { z } from "zod";
import {
  ContentGpsOwnerSuggestionsSchema,
  type ContentGpsOwnerSuggestions,
} from "@repo/shared/content-gps";
import { getAuthGeneration } from "@/auth/auth-store";
import { api, ApiRequestError } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const base = {
  id: z.string().uuid(),
  kind: z.enum(["story_setting", "production_origin"]),
  label: z.string().trim().min(1).max(300),
};
const point = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    coordinateSystem: z.enum(["WGS84", "GCJ02"]),
    precision: z.enum(["country", "region", "city", "place"]),
  })
  .strict();
export const gpsLocationsSchema = z
  .array(
    z.discriminatedUnion("status", [
      z.object({ ...base, status: z.literal("resolved"), point }).strict(),
      z
        .object({
          ...base,
          status: z.enum(["unresolved", "ambiguous", "fictional"]),
          point: z.null(),
        })
        .strict(),
    ])
  )
  .max(100)
  .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length);
const saveSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().min(0).max(2147483646),
    locations: gpsLocationsSchema,
  })
  .strict();
const commandSchema = z
  .object({ clientKey: z.string().uuid(), request: saveSchema })
  .strict()
  .refine((v) => v.clientKey === v.request.requestId);
const revisionSchema = z
  .object({
    version: z.number().int().nonnegative(),
    locations: gpsLocationsSchema.nullable(),
    requestId: z.string().uuid().nullable(),
  })
  .refine((v) =>
    v.version === 0
      ? v.locations === null && v.requestId === null
      : v.locations !== null && v.requestId !== null
  );
const analysisSchema = z
  .object({ requestId: z.string().uuid(), locale: z.enum(["en-US", "zh-CN", "zh-HK"]) })
  .strict();
const analysisCommandSchema = z
  .object({ clientKey: z.string().uuid(), request: analysisSchema })
  .strict()
  .refine((v) => v.clientKey === v.request.requestId);
const analysisReceiptSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["cached", "succeeded", "dispatched", "uncertain"]),
  analysisVersion: z.string().min(1),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});
export type GpsScope = {
  ipId: string;
  userId: string;
  generation: number;
  locale: z.infer<typeof analysisSchema>["locale"];
};
export type GpsLocation = z.infer<typeof gpsLocationsSchema>[number];
export type GpsCommand = z.infer<typeof commandSchema>;
export type GpsRevision = z.infer<typeof revisionSchema>;
export type GpsAnalysisRequest = z.infer<typeof analysisSchema>;
export type GpsAnalysisReceipt = z.infer<typeof analysisReceiptSchema>;
export type GpsSuggestions = ContentGpsOwnerSuggestions;
export class GpsAnalysisMissing extends Error {}
function current(scope: GpsScope, signal?: AbortSignal) {
  if (!scope.userId || scope.generation !== getAuthGeneration() || signal?.aborted)
    throw Error("IP location session expired.");
  z.string().uuid().parse(scope.ipId);
}
const path = (scope: GpsScope) =>
  `/ip-commerce/me/ips/${encodeURIComponent(scope.ipId)}/content-gps`;
export function gpsPending(scope: GpsScope) {
  current(scope);
  const store = pendingRequest(
    commandSchema,
    scope.generation,
    durableRecord("ip-gps-locations", scope.userId, scope.ipId)
  );
  return { ...store, read: () => store.read() ?? null };
}
export function gpsAnalysisPending(scope: GpsScope) {
  current(scope);
  const store = pendingRequest(
    analysisCommandSchema,
    scope.generation,
    durableRecord("ip-gps-analysis", scope.userId, `${scope.ipId}:${scope.locale}`)
  );
  return {
    read: () => {
      const v = store.read()?.request ?? null;
      if (v && v.locale !== scope.locale) throw Error("Analysis locale mismatch.");
      return v;
    },
    save: (raw: GpsAnalysisRequest) => {
      const request = analysisSchema.parse(raw);
      if (request.locale !== scope.locale) throw Error("Analysis locale mismatch.");
      store.save({ clientKey: request.requestId, request });
    },
    clear: (id: string) => store.clear(id),
  };
}
export async function readGpsLocations(scope: GpsScope, signal: AbortSignal) {
  current(scope, signal);
  const raw = await api.get(`${path(scope)}/locations`, {
    service: "aurora",
    signal,
    retry: false,
  });
  current(scope, signal);
  return revisionSchema.parse(raw);
}
function acknowledges(revision: GpsRevision, command: GpsCommand) {
  return (
    revision.requestId === command.request.requestId &&
    revision.version === command.request.expectedVersion + 1 &&
    JSON.stringify(revision.locations) === JSON.stringify(command.request.locations)
  );
}
export async function recoverGpsLocations(scope: GpsScope, signal: AbortSignal) {
  const revision = await readGpsLocations(scope, signal),
    store = gpsPending(scope);
  let pending = store.read();
  if (pending && acknowledges(revision, pending)) {
    store.clear(pending.clientKey);
    pending = null;
  }
  return { revision, pending };
}
export async function saveGpsLocations(scope: GpsScope, input: GpsCommand, signal: AbortSignal) {
  current(scope, signal);
  const command = commandSchema.parse(input),
    store = gpsPending(scope);
  store.save(command);
  const raw = await api.put(`${path(scope)}/locations`, {
    service: "aurora",
    signal,
    retry: false,
    data: command.request,
  });
  current(scope, signal);
  if (!acknowledges(revisionSchema.parse(raw), command))
    throw Error("The location save receipt does not match this request.");
  store.clear(command.clientKey);
  return readGpsLocations(scope, signal);
}
export async function discardGpsLocations(
  scope: GpsScope,
  expected: GpsCommand | null,
  signal: AbortSignal
) {
  const revision = await readGpsLocations(scope, signal),
    store = gpsPending(scope),
    saved = store.read();
  if (JSON.stringify(saved) !== JSON.stringify(expected))
    throw Error("Saved location edits changed. Reload before discarding.");
  if (saved) store.clear(saved.clientKey);
  return revision;
}
export async function readGpsSuggestions(scope: GpsScope, signal: AbortSignal) {
  current(scope, signal);
  const raw = await api.get(`${path(scope)}/suggestions`, {
    service: "aurora",
    signal,
    retry: false,
    params: { locale: scope.locale },
  });
  current(scope, signal);
  const value = ContentGpsOwnerSuggestionsSchema.parse(raw);
  if (
    new Set(value.locations.map((v) => v.id)).size !== value.locations.length ||
    (value.state !== "ready" && value.locations.length)
  )
    throw Error("Invalid location suggestions. Reload them.");
  return value;
}
/** Recheck current ownership, revision and evidence before adding a suggestion to a local draft. */
export async function reviewGpsSuggestion(
  scope: GpsScope,
  version: number,
  expected: GpsSuggestions["locations"][number],
  signal: AbortSignal
) {
  const revision = await readGpsLocations(scope, signal);
  if (revision.version !== version || gpsPending(scope).read())
    throw Error("IP locations changed. Reload before adding suggestions.");
  const suggestions = await readGpsSuggestions(scope, signal);
  const next = suggestions.locations.find((v) => v.id === expected.id);
  if (
    suggestions.state !== "ready" ||
    suggestions.ownerVersion !== version ||
    !next ||
    JSON.stringify(next) !==
      JSON.stringify(ContentGpsOwnerSuggestionsSchema.shape.locations.element.parse(expected))
  )
    throw Error("Location suggestions changed. Load and review them again.");
  return next;
}
function storedAnalysis(scope: GpsScope, request: GpsAnalysisRequest) {
  current(scope);
  const parsed = analysisSchema.parse(request);
  if (
    parsed.locale !== scope.locale ||
    JSON.stringify(gpsAnalysisPending(scope).read()) !== JSON.stringify(parsed)
  )
    throw Error("The saved analysis request changed. Reload the editor.");
}
export async function checkGpsAnalysis(
  scope: GpsScope,
  request: GpsAnalysisRequest,
  signal: AbortSignal
) {
  current(scope, signal);
  storedAnalysis(scope, request);
  let raw: unknown;
  try {
    raw = await api.get(`${path(scope)}/analysis/${request.requestId}`, {
      service: "aurora",
      signal,
      retry: false,
      timeout: 60000,
    });
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) {
      // This endpoint also returns 404 for lost ownership; distinguish it before offering a retry.
      await readGpsLocations(scope, signal);
      storedAnalysis(scope, request);
      throw new GpsAnalysisMissing(e.message);
    }
    throw e;
  }
  current(scope, signal);
  storedAnalysis(scope, request);
  const receipt = analysisReceiptSchema.parse(raw);
  if (receipt.id !== request.requestId)
    throw Error("The analysis receipt does not match this request.");
  return receipt;
}
export async function analyzeGps(scope: GpsScope, input: GpsAnalysisRequest, signal: AbortSignal) {
  current(scope, signal);
  const request = analysisSchema.parse(input);
  if (request.locale !== scope.locale) throw Error("Analysis locale mismatch.");
  const store = gpsAnalysisPending(scope),
    old = store.read();
  if (old) {
    let prior: GpsAnalysisReceipt | null = null;
    try {
      prior = await checkGpsAnalysis(scope, old, signal);
    } catch (e) {
      if (!(e instanceof GpsAnalysisMissing) || old.requestId !== request.requestId) throw e;
    }
    if (prior) {
      if (old.requestId === request.requestId) return prior;
      if (!["cached", "succeeded"].includes(prior.status))
        throw Error("Check the existing analysis. Its outcome is not confirmed.");
    }
  }
  // A missing receipt is not authorization; recheck ownership and pending edits before dispatch.
  await readGpsLocations(scope, signal);
  if (gpsPending(scope).read()) throw Error("Confirm your pending location save before analyzing.");
  if (old && old.requestId !== request.requestId) store.clear(old.requestId);
  store.save(request);
  current(scope, signal);
  storedAnalysis(scope, request);
  await api.post(`${path(scope)}/analyze`, {
    service: "aurora",
    signal,
    retry: false,
    timeout: 60000,
    data: request,
  });
  current(scope, signal);
  return checkGpsAnalysis(scope, request, signal);
}
