import { beforeEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import {
  cancelDiscovery,
  checkDiscovery,
  clearDiscovery,
  discoveryPending,
  recoverDiscoveryStorage,
  retryDiscovery,
  sendDiscovery,
  type AssistantScope,
  type AssistantRequest,
} from "./discovery-assistant-api";
import { emptyStudioQuery } from "../studios/studio-search-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  generation: 1,
  failWrite: false,
  failRead: false,
  records: new Map<string, string>(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post },
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
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => {
      if (h.failRead) throw Error("Read unavailable");
      return h.records.get([ns, user, id].join(":")) ?? null;
    },
    write: (v: string) => {
      if (h.failWrite) throw Error("Storage unavailable");
      h.records.set([ns, user, id].join(":"), v);
    },
  }),
}));
const scope: AssistantScope = {
  userId: "viewer",
  generation: 1,
  locale: "en-US",
  kind: "creators",
};
const request: AssistantRequest = {
  requestId: "11111111-1111-4111-8111-111111111111",
  locale: "en-US",
  conversation: {
    messages: [{ role: "user", content: "A remote studio" }],
    current: { kind: "creators", query: emptyStudioQuery },
  },
};
const success = {
  requestId: request.requestId,
  status: "succeeded",
  result: { status: "clarification", question: "Which city?" },
} as const;
const result = {
  status: "results",
  kind: "creators",
  queryId: "a".repeat(64),
  query: emptyStudioQuery,
  matchedCount: 1,
  accessibleCount: 2,
  requiresLogin: false,
  countScope: "public_platform_creators_with_listed_services",
  cards: [
    {
      id: "studio",
      name: "Studio",
      avatarUrl: "",
      openToWork: true,
      matched: true,
      basedIn: { countryCode: "SG", city: "Singapore" },
      serves: [],
      remote: true,
      showOnMap: false,
      point: null,
      serviceCount: 2,
      matchingServiceCount: 1,
    },
  ],
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.failWrite = false;
  h.failRead = false;
  h.post.mockResolvedValue(success);
  h.get.mockResolvedValue(success);
});
it("persists the exact request before sending once without automatic retries", async () => {
  h.post.mockImplementationOnce(async () => {
    expect(discoveryPending(scope).read()).toEqual(request);
    return success;
  });
  const s = signal();
  expect(await sendDiscovery(scope, request, s)).toEqual(success);
  expect(h.post).toHaveBeenCalledExactlyOnceWith("/content-gps/discovery/requests", {
    service: "aurora",
    signal: s,
    retry: false,
    timeout: 60000,
    data: request,
  });
  expect(discoveryPending(scope).read()).toEqual(request);
});
it("never sends without durable storage or a valid bounded conversation", async () => {
  h.failWrite = true;
  await expect(sendDiscovery(scope, request, signal())).rejects.toThrow("Storage");
  h.failWrite = false;
  h.failRead = false;
  for (const bad of [
    { ...request, locale: "zh-CN" },
    {
      ...request,
      conversation: {
        ...request.conversation,
        messages: [{ role: "user", content: "a".repeat(2001) }],
      },
    },
    {
      ...request,
      conversation: { ...request.conversation, messages: [{ role: "assistant", content: "hi" }] },
    },
    {
      ...request,
      conversation: {
        ...request.conversation,
        messages: Array(13).fill({ role: "user", content: "hi" }),
      },
    },
  ])
    await expect(sendDiscovery(scope, bad as never, signal())).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("keeps a lost reply recoverable and uses GET without replaying a model turn", async () => {
  h.post.mockRejectedValueOnce(Error("Reply lost"));
  await expect(sendDiscovery(scope, request, signal())).rejects.toThrow("Reply lost");
  expect(discoveryPending(scope).read()).toEqual(request);
  expect(await checkDiscovery(scope, request, signal())).toEqual(success);
  expect(h.post).toHaveBeenCalledTimes(1);
  await expect(sendDiscovery(scope, request, signal())).rejects.toThrow("before retrying");
});
it("permits an explicit identical retry only after a fresh 404, never after denial or uncertainty", async () => {
  discoveryPending(scope).save(request);
  for (const status of [401, 403, 409, 500]) {
    h.get.mockRejectedValueOnce(new ApiRequestError("FAILED", "Check failed", status));
    await expect(retryDiscovery(scope, request, signal())).rejects.toThrow("Check failed");
  }
  for (const status of ["dispatched", "uncertain", "cancelled"]) {
    h.get.mockResolvedValueOnce({ requestId: request.requestId, status, result: null });
    expect((await retryDiscovery(scope, request, signal())).status).toBe(status);
  }
  expect(h.post).not.toHaveBeenCalled();
  h.get.mockRejectedValueOnce(new ApiRequestError("MISSING", "Not found", 404));
  await retryDiscovery(scope, request, signal());
  expect(h.post.mock.calls[0][1].data).toEqual(request);
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("checks the preceding turn before replacement and rejects dispatched/uncertain/missing receipts", async () => {
  discoveryPending(scope).save(request);
  const next = { ...request, requestId: "22222222-2222-4222-8222-222222222222" };
  for (const status of ["dispatched", "uncertain"]) {
    h.get.mockResolvedValueOnce({ requestId: request.requestId, status, result: null });
    await expect(sendDiscovery(scope, next, signal())).rejects.toThrow("unresolved");
  }
  h.get.mockRejectedValueOnce(new ApiRequestError("MISSING", "Not found", 404));
  await expect(sendDiscovery(scope, next, signal())).rejects.toThrow("Not found");
  expect(h.post).not.toHaveBeenCalled();
  h.post.mockResolvedValueOnce({ ...success, requestId: next.requestId });
  await sendDiscovery(scope, next, signal());
  expect(discoveryPending(scope).read()).toEqual(next);
});
it("checks request/result identity and strips unconsented map location", async () => {
  discoveryPending(scope).save(request);
  for (const bad of [
    { ...success, requestId: "22222222-2222-4222-8222-222222222222" },
    { ...success, result: null },
    { ...success, result: { ...result, cards: [result.cards[0], result.cards[0]] } },
    { ...success, result: { ...result, matchedCount: 0 } },
  ]) {
    h.get.mockResolvedValueOnce(bad);
    await expect(checkDiscovery(scope, request, signal())).rejects.toThrow("does not match");
  }
  h.get.mockResolvedValueOnce({ ...success, result });
  expect(await checkDiscovery(scope, request, signal())).toMatchObject({
    result: { cards: [{ basedIn: null, point: null }] },
  });
});
it("cancels the saved request and requires a valid terminal acknowledgement before explicit clearing", async () => {
  discoveryPending(scope).save(request);
  h.post.mockResolvedValueOnce({ requestId: request.requestId, status: "cancelled", result: null });
  const s = signal(),
    cancelled = await cancelDiscovery(scope, request, s);
  expect(h.post).toHaveBeenCalledExactlyOnceWith(
    `/content-gps/discovery/requests/${request.requestId}/cancel`,
    { service: "aurora", signal: s, retry: false, timeout: 60000, data: {} }
  );
  for (const bad of [
    { ...success, result: null },
    { requestId: request.requestId, status: "dispatched", result: null },
  ])
    expect(() => clearDiscovery(scope, request, bad as never)).toThrow();
  clearDiscovery(scope, request, cancelled);
  expect(discoveryPending(scope).read()).toBeNull();
});
it("isolates account/locale/mode and ignores aborts, late sessions and changed saved requests", async () => {
  discoveryPending(scope).save(request);
  for (const other of [{ userId: "other" }, { locale: "zh-CN" as const }, { kind: "ips" as const }])
    expect(discoveryPending({ ...scope, ...other }).read()).toBeNull();
  const c = new AbortController();
  c.abort();
  await expect(checkDiscovery(scope, request, c.signal)).rejects.toThrow("expired");
  expect(h.get).not.toHaveBeenCalled();
  h.get.mockImplementationOnce(async () => {
    h.generation = 2;
    return success;
  });
  await expect(checkDiscovery(scope, request, signal())).rejects.toThrow("expired");
  h.generation = 1;
  h.get.mockImplementationOnce(async () => {
    discoveryPending(scope).clear(request.requestId);
    return success;
  });
  await expect(checkDiscovery(scope, request, signal())).rejects.toThrow(
    "saved discovery request changed"
  );
});

it("recovery preserves readable pending requests and does not treat access errors as corrupt data", () => {
  discoveryPending(scope).save(request);
  const before = [...h.records.entries()];
  h.failRead = true;
  expect(() => recoverDiscoveryStorage(scope)).toThrow("Read unavailable");
  expect([...h.records.entries()]).toEqual(before);
  h.failRead = false;
  expect(recoverDiscoveryStorage(scope)).toEqual(request);
  expect([...h.records.entries()]).toEqual(before);
  h.generation++;
  expect(() => recoverDiscoveryStorage(scope)).toThrow("expired");
  expect([...h.records.entries()]).toEqual(before);
});
it("recovery remains failed when the empty replacement cannot be persisted", () => {
  discoveryPending(scope).save(request);
  const key = [...h.records.keys()][0]!;
  h.records.set(key, "bad json");
  h.failWrite = true;
  expect(() => recoverDiscoveryStorage(scope)).toThrow("Storage unavailable");
  expect(h.records.get(key)).toBe("bad json");
  h.failWrite = false;
  expect(recoverDiscoveryStorage(scope)).toBeNull();
  expect(discoveryPending(scope).read()).toBeNull();
  expect(h.post).not.toHaveBeenCalled();
});
