import { beforeEach, expect, it, vi } from "vitest";
import {
  canvasPositionBaseline,
  canvasPositionDraftStore,
  canvasPositionRecovery,
} from "./story-canvas-position-draft";
import type { CanvasUpdateCommand } from "../api/story-canvas-update";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("../api/story-canvas-update", () => ({ canvasUpdatePending: vi.fn() }));
const key = "00000000-0000-4000-8000-000000000001";
const scope = { projectId: key, documentId: key, generation: 1 };
const command = { clientKey: key, yjsUpdateBase64: "AAA=" };
const edit = { action: "moveNodes" as const, positions: [{ nodeId: "a", x: 80, y: 60 }] };
const fixture = () => ({
  meta: {},
  groups: {},
  edges: {},
  assets: {},
  nodes: {
    a: { id: "a", position: { x: 10, y: 20 }, data: { text: "Original" } },
    b: { id: "b", position: { x: 50, y: 60 }, data: { text: "Other" } },
  },
});
let raw: string | null, other: CanvasUpdateCommand | null, failStorage: boolean;
const storage = {
  read: () => raw,
  write: (value: string) => {
    if (failStorage) throw Error("Storage full");
    raw = value;
  },
};
const submit = vi.fn(async (value: CanvasUpdateCommand, _signal: AbortSignal) => ({
  id: key,
  documentId: key,
  sequence: 1,
  operationType: "yjs_update" as const,
  clientMutationId: value.clientKey,
  yjsUpdateBase64: value.yjsUpdateBase64,
}));
const setup = () =>
  canvasPositionRecovery(scope, "user", {
    store: canvasPositionDraftStore(scope, "user", storage),
    client: { read: () => other, submit },
  });
beforeEach(() => {
  raw = null;
  other = null;
  failStorage = false;
  h.generation = 1;
  submit.mockClear();
});
it("retains the original coordinates and proposed movement across reopening", () => {
  setup().stage(fixture(), edit);
  expect(setup().read()).toEqual({ edit, baseline: canvasPositionBaseline(fixture(), edit) });
  expect(() => setup().stage(fixture(), edit)).toThrow("saved movement");
  setup().discard();
  expect(setup().read()).toBeNull();
});
it("allows unrelated content and position changes but detects movement of the selected node", () => {
  const snapshot = fixture();
  setup().stage(snapshot, edit);
  snapshot.nodes.a.data.text = "Concurrent";
  snapshot.nodes.b.position.x = 800;
  expect(setup().validate(snapshot).edit).toEqual(edit);
  snapshot.nodes.a.position.x = 100;
  expect(() => setup().validate(snapshot)).toThrow("positions changed");
  expect(submit).not.toHaveBeenCalled();
});
it("normalizes legacy coordinates like Web and rejects missing or replaced identity", () => {
  const snapshot = fixture();
  const legacy = { ...snapshot, nodes: { a: { id: "a", position: "legacy" } } };
  expect(canvasPositionBaseline(legacy, edit)).toBe(JSON.stringify([{ nodeId: "a", x: 0, y: 0 }]));
  expect(() => canvasPositionBaseline({ ...snapshot, nodes: {} }, edit)).toThrow();
  expect(() =>
    canvasPositionBaseline({ ...snapshot, nodes: { a: { id: "replacement" } } }, edit)
  ).toThrow();
});
it("retries exact bytes after a lost response even when the server positions have changed", async () => {
  setup().stage(fixture(), edit);
  setup().prepare(command);
  submit.mockRejectedValueOnce(Error("Lost response"));
  await expect(setup().resume(new AbortController().signal)).rejects.toThrow("Lost response");
  expect(setup().validate({ ...fixture(), nodes: {} }).command).toEqual(command);
  await setup().resume(new AbortController().signal);
  expect(submit.mock.calls.map((call) => call[0])).toEqual([command, command]);
  expect(setup().read()).toBeNull();
});
it("does not replace or discard a prepared operation", () => {
  setup().stage(fixture(), edit);
  setup().prepare(command);
  setup().prepare(command);
  expect(() => setup().prepare({ ...command, yjsUpdateBase64: "AQI=" })).toThrow("already pending");
  expect(() => setup().discard()).toThrow("Retry");
  expect(setup().read()?.command).toEqual(command);
});
it("preserves a foreign transport operation before staging and before submission", async () => {
  other = command;
  expect(() => setup().stage(fixture(), edit)).toThrow("saved canvas action");
  expect(raw).toBeNull();
  other = null;
  setup().stage(fixture(), edit);
  setup().prepare(command);
  other = { ...command, yjsUpdateBase64: "AQI=" };
  await expect(setup().resume(new AbortController().signal)).rejects.toThrow("saved canvas action");
  expect(submit).not.toHaveBeenCalled();
  expect(setup().read()?.command).toEqual(command);
});
it("retains recovery after storage fails to clear an acknowledged movement", async () => {
  setup().stage(fixture(), edit);
  setup().prepare(command);
  failStorage = true;
  await expect(setup().resume(new AbortController().signal)).rejects.toThrow("Storage full");
  failStorage = false;
  expect(setup().read()?.command).toEqual(command);
  await setup().resume(new AbortController().signal);
  expect(submit.mock.calls.map((call) => call[0])).toEqual([command, command]);
});
it("preserves corrupt records and never submits when preparation cannot persist", () => {
  raw = "corrupt";
  expect(() => setup().stage(fixture(), edit)).toThrow();
  expect(raw).toBe("corrupt");
  raw = null;
  setup().stage(fixture(), edit);
  failStorage = true;
  expect(() => setup().prepare(command)).toThrow("Storage full");
  expect(setup().read()?.command).toBeUndefined();
  expect(submit).not.toHaveBeenCalled();
});
it("rejects aborted sends and preserves bytes if the account retires after receipt", async () => {
  setup().stage(fixture(), edit);
  setup().prepare(command);
  const controller = new AbortController();
  controller.abort();
  await expect(setup().resume(controller.signal)).rejects.toThrow();
  expect(submit).not.toHaveBeenCalled();
  submit.mockImplementationOnce(async (value) => {
    h.generation++;
    return {
      id: key,
      documentId: key,
      sequence: 1,
      operationType: "yjs_update",
      clientMutationId: value.clientKey,
      yjsUpdateBase64: value.yjsUpdateBase64,
    };
  });
  await expect(setup().resume(new AbortController().signal)).rejects.toThrow("expired");
  expect(JSON.parse(raw!).draft.command).toEqual(command);
});
it("accepts recoloring but blocks changed group membership before encoding", () => {
  const snapshot = {
    ...fixture(),
    groups: { group: { id: "group", nodeIds: ["a", "b"], color: "red" } },
  };
  const grouped = {
    ...edit,
    groupId: "group",
    positions: [...edit.positions, { nodeId: "b", x: 120, y: 100 }],
  };
  setup().stage(snapshot, grouped);
  snapshot.groups.group.color = "blue";
  expect(setup().validate(snapshot).edit).toEqual(grouped);
  snapshot.groups.group.nodeIds = ["a"];
  expect(() => setup().validate(snapshot)).toThrow("membership changed");
  expect(setup().read()?.edit).toEqual(grouped);
  expect(submit).not.toHaveBeenCalled();
});
it("rejects a tidy proposal after wires change, but keeps independent text edits", () => {
  const original = fixture();
  const snapshot = {
    ...original,
    nodes: { a: { ...original.nodes.a, type: "note" }, b: { ...original.nodes.b, type: "note" } },
    edges: { ab: { id: "ab", source: "a", target: "b" } },
  };
  setup().stage(snapshot, edit, []);
  snapshot.nodes.a.data.text = "Updated";
  expect(setup().validate(snapshot).tidy?.selection).toEqual([]);
  expect(() => setup().validate({ ...snapshot, edges: {} })).toThrow("layout changed");
  expect(submit).not.toHaveBeenCalled();
  setup().prepare(command);
  expect(setup().validate({ ...snapshot, edges: {} }).command).toEqual(command);
});
