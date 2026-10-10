import { beforeEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import {
  analyzeGps,
  checkGpsAnalysis,
  discardGpsLocations,
  gpsAnalysisPending,
  gpsPending,
  readGpsLocations,
  readGpsSuggestions,
  recoverGpsLocations,
  reviewGpsSuggestion,
  saveGpsLocations,
  GpsAnalysisMissing,
  type GpsScope,
} from "./content-gps-api";
import { alreadySuggested, gpsDrafts, parseGpsDrafts, suggestionDraft } from "./content-gps-draft";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
  failWrite: false,
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, post: h.post },
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, u: string, id: string) => ({
    read: () => h.records.get(ns + u + id) ?? null,
    write: (v: string) => {
      if (h.failWrite) throw Error("Storage unavailable");
      h.records.set(ns + u + id, v);
    },
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const scope: GpsScope = { ipId: id, userId: "owner", generation: 1, locale: "en-US" };
const row = {
  id: other,
  kind: "story_setting" as const,
  label: "Singapore",
  status: "unresolved" as const,
  point: null,
};
const command = { clientKey: id, request: { requestId: id, expectedVersion: 0, locations: [row] } };
const unset = { version: 0, locations: null, requestId: null };
const revision = { version: 1, locations: [row], requestId: id };
const request = { requestId: id, locale: "en-US" as const };
const receipt = {
  id,
  status: "succeeded",
  analysisVersion: "v1",
  sourceFingerprint: "a".repeat(64),
  createdAt: "2026-10-01T00:00:00.000Z",
  finishedAt: "2026-10-01T00:01:00.000Z",
};
const suggestion = {
  ...row,
  id: "suggestion-1",
  evidence: [{ quote: "Set in Singapore", sourceType: "ip_localization", field: "description" }],
};
const suggestions = {
  state: "ready",
  analysisVersion: "v1",
  analyzedAt: "2026-10-01T00:00:00.000Z",
  ownerVersion: 0,
  locations: [suggestion],
};
const signal = () => new AbortController().signal;
const missing = () => new ApiRequestError("NOT_FOUND", "Analysis not found", 404);
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.failWrite = false;
  h.get.mockResolvedValue(unset);
  h.put.mockResolvedValue(revision);
});
it("distinguishes unset locations from an explicit empty override and validates coordinates and unique IDs", async () => {
  expect(await readGpsLocations(scope, signal())).toEqual(unset);
  h.get.mockResolvedValueOnce({ ...revision, locations: [] });
  expect((await readGpsLocations(scope, signal())).locations).toEqual([]);
  expect(parseGpsDrafts(gpsDrafts([row, row])).success).toBe(false);
  const draft = {
    ...gpsDrafts([row])[0]!,
    status: "resolved" as const,
    latitude: "",
    longitude: "103.8",
  };
  expect(parseGpsDrafts([draft]).success).toBe(false);
  expect(parseGpsDrafts([{ ...draft, latitude: "91" }]).success).toBe(false);
  expect(parseGpsDrafts([{ ...draft, latitude: "1.3" }]).success).toBe(true);
  expect(parseGpsDrafts([{ ...draft, status: "fictional" }]).success).toBe(true);
});
it("persists exact saves before PUT and refreshes after a historical replay receipt", async () => {
  h.put.mockImplementationOnce(async () => {
    expect(gpsPending(scope).read()).toEqual(command);
    return revision;
  });
  const latest = { ...revision, version: 3, requestId: other, locations: [] };
  h.get.mockResolvedValueOnce(latest);
  const s = signal();
  expect(await saveGpsLocations(scope, command, s)).toEqual(latest);
  expect(h.put).toHaveBeenCalledExactlyOnceWith(`/ip-commerce/me/ips/${id}/content-gps/locations`, {
    service: "aurora",
    signal: s,
    retry: false,
    data: command.request,
  });
  expect(gpsPending(scope).read()).toBeNull();
});
it("recovers only an exact lost receipt, never clearing another revision or sending automatically", async () => {
  h.put.mockRejectedValueOnce(Error("Reply lost"));
  await expect(saveGpsLocations(scope, command, signal())).rejects.toThrow("Reply lost");
  h.get.mockResolvedValueOnce({ ...revision, version: 2, requestId: other });
  expect((await recoverGpsLocations(scope, signal())).pending).toEqual(command);
  h.get.mockResolvedValueOnce(revision);
  expect((await recoverGpsLocations(scope, signal())).pending).toBeNull();
  expect(h.put).toHaveBeenCalledTimes(1);
});
it("retains conflicts and mismatched receipts and refuses to replace a pending command", async () => {
  h.put.mockResolvedValueOnce({ ...revision, locations: [] });
  await expect(saveGpsLocations(scope, command, signal())).rejects.toThrow("receipt");
  expect(gpsPending(scope).read()).toEqual(command);
  await expect(
    saveGpsLocations(
      scope,
      { ...command, request: { ...command.request, locations: [] } },
      signal()
    )
  ).rejects.toThrow("pending");
  h.put.mockRejectedValueOnce(new ApiRequestError("CONFLICT", "Locations changed", 409));
  await expect(saveGpsLocations(scope, command, signal())).rejects.toThrow("Locations changed");
  expect(gpsPending(scope).read()).toEqual(command);
});
it("does not send without durable storage and cannot replay an acknowledged save after failed refresh", async () => {
  h.failWrite = true;
  await expect(saveGpsLocations(scope, command, signal())).rejects.toThrow("Storage");
  expect(h.put).not.toHaveBeenCalled();
  h.failWrite = false;
  h.get.mockRejectedValueOnce(Error("Refresh failed"));
  await expect(saveGpsLocations(scope, command, signal())).rejects.toThrow("Refresh failed");
  expect(gpsPending(scope).read()).toBeNull();
});
it("discards only the reviewed local command after fresh ownership read, with no remote undo", async () => {
  gpsPending(scope).save(command);
  await expect(discardGpsLocations(scope, null, signal())).rejects.toThrow("changed");
  h.get.mockRejectedValueOnce(new ApiRequestError("DENIED", "Owner required", 403));
  await expect(discardGpsLocations(scope, command, signal())).rejects.toThrow("Owner required");
  expect(gpsPending(scope).read()).toEqual(command);
  h.get.mockResolvedValueOnce(revision);
  expect(await discardGpsLocations(scope, command, signal())).toEqual(revision);
  expect(gpsPending(scope).read()).toBeNull();
  expect(h.put).not.toHaveBeenCalled();
});
it("isolates owners, IPs and analysis locales and ignores aborted or late account replies", async () => {
  gpsPending(scope).save(command);
  gpsAnalysisPending(scope).save(request);
  expect(gpsPending({ ...scope, userId: "other" }).read()).toBeNull();
  expect(gpsPending({ ...scope, ipId: other }).read()).toBeNull();
  expect(gpsAnalysisPending({ ...scope, locale: "zh-CN" }).read()).toBeNull();
  h.put.mockImplementationOnce(async () => {
    h.generation = 2;
    return revision;
  });
  await expect(saveGpsLocations(scope, command, signal())).rejects.toThrow("expired");
  h.generation = 1;
  expect(gpsPending(scope).read()).toEqual(command);
  const c = new AbortController();
  c.abort();
  await expect(readGpsLocations(scope, c.signal)).rejects.toThrow("expired");
});
it("rechecks owner revision and evidence before adoption; adding a suggestion is not a write", async () => {
  h.get.mockResolvedValueOnce(unset).mockResolvedValueOnce(suggestions);
  const next = await reviewGpsSuggestion(scope, 0, suggestion as never, signal());
  expect(suggestionDraft(next, other).id).toBe(other);
  expect(alreadySuggested(gpsDrafts([row]), next)).toBe(true);
  expect(h.put).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
  h.get.mockResolvedValueOnce(revision);
  await expect(reviewGpsSuggestion(scope, 0, next, signal())).rejects.toThrow("changed");
  h.get
    .mockResolvedValueOnce(unset)
    .mockResolvedValueOnce({ ...suggestions, locations: [{ ...suggestion, label: "Changed" }] });
  await expect(reviewGpsSuggestion(scope, 0, next, signal())).rejects.toThrow("review");
});
it("rejects duplicate suggestions and strips provider metadata when adopting resolved coordinates", async () => {
  h.get.mockResolvedValueOnce({ ...suggestions, locations: [suggestion, suggestion] });
  await expect(readGpsSuggestions(scope, signal())).rejects.toThrow("Invalid");
  const point = {
    latitude: 1.3,
    longitude: 103.8,
    coordinateSystem: "WGS84",
    precision: "city",
    provider: "mapbox",
    providerPlaceId: "place",
  };
  h.get.mockResolvedValueOnce({
    ...suggestions,
    locations: [{ ...suggestion, status: "resolved", point }],
  });
  const next = (await readGpsSuggestions(scope, signal())).locations[0]!;
  const parsed = parseGpsDrafts([suggestionDraft(next, other)]);
  expect(parsed.success).toBe(true);
  if (parsed.success) expect(parsed.data[0]!.point).not.toHaveProperty("provider");
});
it("persists analysis before explicit dispatch and then reads the exact receipt", async () => {
  h.post.mockImplementationOnce(async () => {
    expect(gpsAnalysisPending(scope).read()).toEqual(request);
    return { ignored: true };
  });
  h.get.mockResolvedValueOnce(unset).mockResolvedValueOnce(receipt);
  const s = signal();
  expect(await analyzeGps(scope, request, s)).toEqual(receipt);
  expect(h.post).toHaveBeenCalledExactlyOnceWith(`/ip-commerce/me/ips/${id}/content-gps/analyze`, {
    service: "aurora",
    signal: s,
    retry: false,
    timeout: 60000,
    data: request,
  });
});
it("checks without dispatch and never replaces uncertain or dispatched analysis", async () => {
  gpsAnalysisPending(scope).save(request);
  for (const status of ["uncertain", "dispatched"]) {
    h.get.mockResolvedValueOnce({ ...receipt, status });
    expect((await checkGpsAnalysis(scope, request, signal())).status).toBe(status);
    h.get.mockResolvedValueOnce({ ...receipt, status });
    await expect(analyzeGps(scope, { ...request, requestId: other }, signal())).rejects.toThrow(
      "not confirmed"
    );
    h.get.mockResolvedValueOnce({ ...receipt, status });
    expect((await analyzeGps(scope, request, signal())).status).toBe(status);
  }
  expect(h.post).not.toHaveBeenCalled();
});
it("retries a missing analysis only with its original ID after revalidating ownership", async () => {
  gpsAnalysisPending(scope).save(request);
  h.get.mockRejectedValueOnce(missing()).mockResolvedValueOnce(unset);
  await expect(checkGpsAnalysis(scope, request, signal())).rejects.toBeInstanceOf(
    GpsAnalysisMissing
  );
  h.get.mockRejectedValueOnce(missing()).mockResolvedValueOnce(unset);
  await expect(
    analyzeGps(scope, { ...request, requestId: other }, signal())
  ).rejects.toBeInstanceOf(GpsAnalysisMissing);
  expect(h.post).not.toHaveBeenCalled();
  h.get
    .mockRejectedValueOnce(missing())
    .mockResolvedValueOnce(unset)
    .mockResolvedValueOnce(unset)
    .mockResolvedValueOnce(receipt);
  await analyzeGps(scope, request, signal());
  expect(h.post.mock.calls[0][1].data).toEqual(request);
});
it("does not mistake loss of IP ownership for a missing analysis receipt", async () => {
  gpsAnalysisPending(scope).save(request);
  h.get
    .mockRejectedValueOnce(missing())
    .mockRejectedValueOnce(new ApiRequestError("NOT_FOUND", "IP not found", 404));
  await expect(checkGpsAnalysis(scope, request, signal())).rejects.toThrow("IP not found");
  expect(h.post).not.toHaveBeenCalled();
  expect(gpsAnalysisPending(scope).read()).toEqual(request);
});
it("starts another analysis only after a fresh terminal receipt and refuses local-storage failure or pending edits", async () => {
  gpsAnalysisPending(scope).save(request);
  h.get
    .mockResolvedValueOnce(receipt)
    .mockResolvedValueOnce(unset)
    .mockResolvedValueOnce({ ...receipt, id: other });
  await analyzeGps(scope, { ...request, requestId: other }, signal());
  expect(h.post.mock.calls[0][1].data.requestId).toBe(other);
  h.records.clear();
  h.failWrite = true;
  await expect(analyzeGps(scope, request, signal())).rejects.toThrow("Storage");
  expect(h.post).toHaveBeenCalledTimes(1);
  h.failWrite = false;
  gpsPending(scope).save(command);
  await expect(analyzeGps(scope, request, signal())).rejects.toThrow("pending");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("retains lost analysis requests and rejects mismatched receipts and changed locale", async () => {
  h.post.mockRejectedValueOnce(Error("Reply lost"));
  await expect(analyzeGps(scope, request, signal())).rejects.toThrow("Reply lost");
  expect(gpsAnalysisPending(scope).read()).toEqual(request);
  h.get.mockResolvedValueOnce({ ...receipt, id: other });
  await expect(checkGpsAnalysis(scope, request, signal())).rejects.toThrow("receipt");
  await expect(analyzeGps(scope, { ...request, locale: "zh-CN" }, signal())).rejects.toThrow(
    "locale"
  );
  expect(h.post).toHaveBeenCalledTimes(1);
});
