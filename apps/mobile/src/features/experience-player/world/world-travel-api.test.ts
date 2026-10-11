import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorldTravelController } from "./world-travel-controller";
import { createWorldTravelApi } from "./world-travel-api";
const h = vi.hoisted(() => ({ generation: 1, post: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const worldId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const travelId = "55555555-5555-4555-8555-555555555555";
const scope = { workspaceId, projectId, worldId, generation: 1 };
const connection = {
  apiBaseUrl: "https://world.example/api",
  ticket: "fixture-ticket",
  token: "fixture-token",
  tokenExpiresIn: 60,
};
const session = {
  id: sessionId,
  worldId,
  providerKey: "fal:happy-oyster",
  heartbeatIntervalSeconds: 30,
  sessionTimeoutSeconds: 120,
  maxExperienceSeconds: 90,
  connection,
};
beforeEach(() => {
  h.generation = 1;
  h.post.mockReset();
});

it("runs the session transport sequence with the original workspace header", async () => {
  const input = { ...scope };
  const client = createWorldTravelApi(input);
  input.workspaceId = travelId;
  h.post.mockResolvedValueOnce(session);
  await client.createWorldSession({ tokenSeconds: 60, maxExperienceSeconds: 90 });
  h.post.mockResolvedValueOnce({ id: travelId, sessionId, worldId, status: "running" });
  await client.bindWorldTravel(sessionId, { providerTravelId: "provider-travel" });
  h.post.mockResolvedValueOnce({ alive: true, heartbeatIntervalSeconds: 30 });
  await client.heartbeatWorldSession(sessionId);
  h.post.mockResolvedValueOnce({
    token: "renewed",
    tokenExpiresIn: 60,
    apiBaseUrl: connection.apiBaseUrl,
  });
  await client.refreshWorldSessionToken(sessionId, { tokenSeconds: 60 });
  h.post.mockResolvedValueOnce({
    id: travelId,
    worldId,
    status: "running",
    rtcStatus: "PLAYING",
    updatedAt: null,
  });
  await client.reportWorldTravelStatus(travelId, {
    streamStatus: "PLAYING",
    streamStatusChangedAtMs: 123,
  });
  h.post.mockResolvedValueOnce({ closed: true });
  await client.closeWorldSession(sessionId, { travelCompleted: false });
  expect(h.post.mock.calls.map(([url]) => url)).toEqual([
    `/story-projects/${projectId}/world-model/worlds/${worldId}/sessions`,
    ...["bind-travel", "heartbeat", "token"].map(
      (action) => `/story-projects/${projectId}/world-model/sessions/${sessionId}/${action}`
    ),
    `/story-projects/${projectId}/world-model/travels/${travelId}/status`,
    `/story-projects/${projectId}/world-model/sessions/${sessionId}/close`,
  ]);
  for (const [, options] of h.post.mock.calls)
    expect(options).toMatchObject({
      service: "aurora",
      headers: { "X-Fizz-Workspace-Id": workspaceId },
      retry: false,
    });
});

it("rejects expired account scope before sending any request", async () => {
  const client = createWorldTravelApi(scope);
  h.generation++;
  await expect(client.createWorldSession({ tokenSeconds: 60 })).rejects.toThrow("session expired");
  await expect(client.closeWorldSession(sessionId, { travelCompleted: false })).rejects.toThrow(
    "session expired"
  );
  expect(h.post).not.toHaveBeenCalled();
});

it("does not expose connection credentials from a late previous-account response", async () => {
  const client = createWorldTravelApi(scope);
  h.post.mockImplementation(async () => {
    h.generation++;
    return session;
  });
  await expect(client.createWorldSession({ tokenSeconds: 60 })).rejects.toThrow("session expired");
});

it("does not retry a failed session creation or replace the server message", async () => {
  h.post.mockRejectedValue(new Error("Provider quota exhausted"));
  await expect(
    createWorldTravelApi(scope).createWorldSession({ tokenSeconds: 60 })
  ).rejects.toThrow("Provider quota exhausted");
  expect(h.post).toHaveBeenCalledOnce();
});

it("rejects a connection belonging to another world", async () => {
  h.post.mockResolvedValue({ ...session, worldId: travelId });
  await expect(
    createWorldTravelApi(scope).createWorldSession({ tokenSeconds: 60 })
  ).rejects.toThrow("scope mismatch");
});

it.each(["sessionId", "worldId"])("rejects a foreign bound travel %s", async (field) => {
  h.post.mockResolvedValue({
    id: travelId,
    sessionId,
    worldId,
    status: "running",
    [field]: projectId,
  });
  await expect(
    createWorldTravelApi(scope).bindWorldTravel(sessionId, { providerTravelId: "provider-travel" })
  ).rejects.toThrow("scope mismatch");
});

it("does not mark rejected cleanup as successful", async () => {
  h.post.mockResolvedValue({ closed: false });
  await expect(
    createWorldTravelApi(scope).closeWorldSession(sessionId, { travelCompleted: false })
  ).rejects.toThrow("did not close");
});

it("rejects invalid scope and request payloads before transport", async () => {
  expect(() => createWorldTravelApi({ ...scope, projectId: "../other" })).toThrow();
  await expect(
    createWorldTravelApi(scope).createWorldSession({ tokenSeconds: 1 })
  ).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});

it("requires a valid heartbeat response rather than assuming the lease is alive", async () => {
  h.post.mockResolvedValue({ alive: "true", heartbeatIntervalSeconds: 0 });
  await expect(createWorldTravelApi(scope).heartbeatWorldSession(sessionId)).rejects.toThrow();
});

afterEach(() => vi.useRealTimers());
it("retires the provider runtime after an account switch without closing under the new account", async () => {
  vi.useFakeTimers();
  const runtime = {
    can: () => true,
    start: vi.fn().mockResolvedValue({
      providerTravelId: "provider-travel",
      firstFrameUrl: null,
      maxExperienceSeconds: 90,
    }),
    move: vi.fn(),
    instruct: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    rewind: vi.fn(),
    updateToken: vi.fn(),
    end: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  h.post
    .mockResolvedValueOnce(session)
    .mockResolvedValueOnce({ id: travelId, sessionId, worldId, status: "running" });
  const controller = new WorldTravelController({
    api: createWorldTravelApi(scope),
    runtimeFactory: async () => runtime,
  });
  await controller.start();
  expect(controller.state.phase).toBe("running");
  h.generation++;
  await vi.advanceTimersByTimeAsync(30000);
  expect(controller.state.phase).toBe("failed");
  expect(runtime.dispose).toHaveBeenCalledOnce();
  expect(h.post).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(120000);
  expect(h.post).toHaveBeenCalledTimes(2);
});
it("does not construct a provider runtime from a late previous-account connection", async () => {
  const factory = vi.fn();
  h.post.mockImplementation(async () => {
    h.generation++;
    return session;
  });
  const controller = new WorldTravelController({
    api: createWorldTravelApi(scope),
    runtimeFactory: factory,
  });
  await expect(controller.start()).rejects.toThrow("session expired");
  expect(factory).not.toHaveBeenCalled();
  expect(controller.state.phase).toBe("failed");
  expect(h.post).toHaveBeenCalledOnce();
});
