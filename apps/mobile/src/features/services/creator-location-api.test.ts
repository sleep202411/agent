import { beforeEach, expect, it, vi } from "vitest";
import {
  locationPending,
  recoverLocation,
  saveLocation,
  resolveLocationGeocode,
  readLocation,
} from "./creator-location-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
  failWrite: false,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, put: h.put, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get([ns, user, id].join(":")) ?? null,
    write: (value: string) => {
      if (h.failWrite) throw new Error("Storage unavailable");
      h.records.set([ns, user, id].join(":"), value);
    },
  }),
}));
const scope = { userId: "owner", generation: 1 };
const profile = {
  basedIn: { countryCode: "SG", city: "Singapore" },
  serves: [],
  remote: true,
  showOnMap: true,
};
const command = {
  clientKey: "11111111-1111-4111-8111-111111111111",
  request: { requestId: "11111111-1111-4111-8111-111111111111", expectedVersion: 2, profile },
};
const receipt = { version: 3, profile, requestId: command.clientKey };
const signal = () => new AbortController().signal;
const mapState = (state: string, version = 3) => ({ version, state, attemptId: null, point: null });
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.failWrite = false;
  h.put.mockResolvedValue(receipt);
  h.get.mockResolvedValue(receipt);
});
it("persists before PUT, sends only the official payload and refreshes after the exact receipt", async () => {
  h.put.mockImplementationOnce(async () => {
    expect(locationPending(scope).read()).toEqual(command);
    return receipt;
  });
  const newer = {
    ...receipt,
    version: 4,
    requestId: "22222222-2222-4222-8222-222222222222",
    profile: { ...profile, remote: false },
  };
  h.get.mockResolvedValueOnce(newer);
  const s = signal();
  expect(await saveLocation(scope, command, s)).toEqual(newer);
  expect(h.put).toHaveBeenCalledExactlyOnceWith("/creator-location/me", {
    service: "aurora",
    retry: false,
    signal: s,
    data: command.request,
  });
  expect(locationPending(scope).read()).toBeNull();
});
it("recovers an exact lost receipt on read, but keeps an unrelated newer revision pending", async () => {
  h.put.mockRejectedValueOnce(new Error("Offline"));
  await expect(saveLocation(scope, command, signal())).rejects.toThrow("Offline");
  h.get.mockResolvedValueOnce({
    ...receipt,
    version: 4,
    requestId: "22222222-2222-4222-8222-222222222222",
  });
  expect((await recoverLocation(scope, signal())).pending).toEqual(command);
  expect((await recoverLocation(scope, signal())).pending).toBeNull();
  expect(h.put).toHaveBeenCalledTimes(1);
});
it("retains pending on mismatched receipts and refuses to replace the exact command", async () => {
  for (const patch of [
    { version: 8 },
    { profile: { ...profile, remote: false } },
    { requestId: null },
  ]) {
    h.put.mockResolvedValueOnce({ ...receipt, ...patch });
    await expect(saveLocation(scope, command, signal())).rejects.toThrow("receipt");
    expect(locationPending(scope).read()).toEqual(command);
  }
  await expect(
    saveLocation(
      scope,
      { ...command, request: { ...command.request, expectedVersion: 4 } },
      signal()
    )
  ).rejects.toThrow("pending");
  expect(h.put).toHaveBeenCalledTimes(3);
});
it("does not send if durable storage fails; a failed refresh after acknowledgement cannot replay the write", async () => {
  h.failWrite = true;
  await expect(saveLocation(scope, command, signal())).rejects.toThrow("Storage");
  expect(h.put).not.toHaveBeenCalled();
  h.failWrite = false;
  h.get.mockRejectedValueOnce(new Error("Read failed"));
  await expect(saveLocation(scope, command, signal())).rejects.toThrow("Read failed");
  expect(locationPending(scope).read()).toBeNull();
});
it("rejects duplicate normalized service cities and invalid map consent without dispatch", async () => {
  for (const p of [
    { ...profile, basedIn: null },
    {
      ...profile,
      serves: [
        { countryCode: "SG", city: "Singapore" },
        { countryCode: "SG", city: "SINGAPORE" },
      ],
    },
  ]) {
    await expect(
      saveLocation(scope, { ...command, request: { ...command.request, profile: p } }, signal())
    ).rejects.toThrow();
  }
  expect(h.put).not.toHaveBeenCalled();
});
it("isolates owners, ignores late account responses and leaves their pending receipt recoverable", async () => {
  locationPending(scope).save(command);
  expect(locationPending({ ...scope, userId: "other" }).read()).toBeNull();
  h.put.mockImplementationOnce(async () => {
    h.generation = 2;
    return receipt;
  });
  await expect(saveLocation(scope, command, signal())).rejects.toThrow("expired");
  h.generation = 1;
  expect(locationPending(scope).read()).toEqual(command);
  const c = new AbortController();
  c.abort();
  await expect(readLocation(scope, c.signal)).rejects.toThrow("expired");
});
it("revalidates version, consent and provider state before an explicit geocode call", async () => {
  h.get.mockResolvedValueOnce(receipt).mockResolvedValueOnce(mapState("missing"));
  h.post.mockResolvedValueOnce(mapState("unresolved"));
  const s = signal();
  expect((await resolveLocationGeocode(scope, 3, "en-US", s)).state).toBe("unresolved");
  expect(h.post).toHaveBeenCalledExactlyOnceWith("/creator-location/me/geocode", {
    service: "aurora",
    retry: false,
    signal: s,
    data: { expectedVersion: 3, locale: "en-US" },
  });
});
it("never resends dispatched/uncertain/disabled attempts or resolves a changed or unconsented revision", async () => {
  for (const state of [
    "dispatched",
    "uncertain",
    "disabled",
    "unresolved",
    "ambiguous",
    "ineligible",
  ]) {
    h.get.mockResolvedValueOnce(receipt).mockResolvedValueOnce(mapState(state));
    await expect(resolveLocationGeocode(scope, 3, "en-US", signal())).rejects.toThrow("existing");
  }
  for (const patch of [{ version: 4 }, { profile: { ...profile, showOnMap: false } }]) {
    h.get.mockResolvedValueOnce({ ...receipt, ...patch });
    await expect(resolveLocationGeocode(scope, 3, "en-US", signal())).rejects.toThrow("changed");
  }
  locationPending(scope).save(command);
  await expect(resolveLocationGeocode(scope, 3, "en-US", signal())).rejects.toThrow("pending");
  expect(h.post).not.toHaveBeenCalled();
});
