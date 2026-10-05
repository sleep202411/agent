import { beforeEach, expect, it, vi } from "vitest";
import { platformActorDraftStore } from "./platform-actor-draft";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const scope = {
  kind: "platform" as const,
  workspaceId: id,
  projectId: id,
  sectionId: id,
  documentId: id,
  generation: 1,
};
const intent = { actorId: id, clientKey: other };
const receipt = {
  nodeId: other,
  actorId: id,
  name: "Actor",
  mediaAssetId: id,
  url: `/aurora/media/assets/${id}/content`,
};
const command = { clientKey: other, yjsUpdateBase64: "AAA=" };
let raw: string | null;
const storage = {
  read: () => raw,
  write: (value: string) => {
    raw = value;
  },
};
beforeEach(() => {
  raw = null;
  h.generation = 1;
});
it("recovers each checkpoint across store recreation and clears after acknowledgement", () => {
  const first = platformActorDraftStore(scope, "user", storage);
  first.write(intent);
  first.write({ ...intent, receipt });
  const resumed = platformActorDraftStore(scope, "user", storage);
  expect(resumed.read()).toEqual({ ...intent, receipt });
  resumed.write({ ...intent, receipt, command });
  expect(platformActorDraftStore(scope, "user", storage).read()).toEqual({
    ...intent,
    receipt,
    command,
  });
  resumed.acknowledge(other);
  expect(resumed.read()).toBeNull();
});
it("cannot replace pending identity, receipt or exact bytes", () => {
  const store = platformActorDraftStore(scope, "user", storage);
  store.write({ ...intent, receipt, command });
  expect(() => store.write({ actorId: other, clientKey: id })).toThrow("pending");
  expect(() =>
    store.write({ ...intent, receipt: { ...receipt, name: "Changed" }, command })
  ).toThrow("receipt");
  expect(() =>
    store.write({ ...intent, receipt, command: { ...command, yjsUpdateBase64: "AQI=" } })
  ).toThrow("exact");
  expect(store.read()).toEqual({ ...intent, receipt, command });
});
it("rejects a mismatched receipt or an update without a receipt", () => {
  const store = platformActorDraftStore(scope, "user", storage);
  expect(() => store.write({ ...intent, receipt: { ...receipt, nodeId: id } })).toThrow();
  expect(() => store.write({ ...intent, command })).toThrow();
  expect(store.read()).toBeNull();
});
it("does not clear unresolved intent or another insertion", () => {
  const store = platformActorDraftStore(scope, "user", storage);
  store.write(intent);
  expect(() => store.acknowledge(other)).toThrow("acknowledgement");
  store.write({ ...intent, receipt });
  expect(() => store.acknowledge(id)).toThrow("acknowledgement");
  expect(store.read()).toEqual({ ...intent, receipt });
});
it("rejects late checkpoint writes after account changes", () => {
  const store = platformActorDraftStore(scope, "user", storage);
  store.write(intent);
  h.generation++;
  expect(() => store.write({ ...intent, receipt })).toThrow("session");
  expect(() => store.read()).toThrow("session");
});
it("allows explicit discard before encoding but retains uncertain prepared saves", () => {
  const store = platformActorDraftStore(scope, "user", storage);
  store.write({ ...intent, receipt });
  expect(() => store.discardUnprepared(id)).toThrow("prepared");
  store.discardUnprepared(other);
  expect(store.read()).toBeNull();
  store.write({ ...intent, receipt, command });
  expect(() => store.discardUnprepared(other)).toThrow("prepared");
  expect(store.read()).toEqual({ ...intent, receipt, command });
});
