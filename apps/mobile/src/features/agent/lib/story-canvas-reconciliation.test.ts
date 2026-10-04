import { beforeEach, expect, it, vi } from "vitest";
import { canvasReconciliation } from "./story-canvas-reconciliation";
import type { CanvasUpdateCommand } from "../api/story-canvas-update";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("../api/story-canvas-update", async () => {
  const { canvasUpdateSchema } = await import("../../../../canvas-editor/protocol");
  return { canvasUpdateSchema, canvasUpdatePending: vi.fn() };
});
const key = "00000000-0000-4000-8000-000000000001";
const command = { clientKey: key, yjsUpdateBase64: "AAA=" };
const scope = { projectId: key, documentId: key, generation: 1 };
let raw: string | null;
let other: CanvasUpdateCommand | null;
let hasDraft: boolean;
let writeFails: boolean;
const storage = {
  read: () => raw,
  write: (value: string) => {
    if (writeFails) throw Error("Storage full");
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
  canvasReconciliation(scope, "user", {
    storage,
    client: { read: () => other, submit },
    hasDraft: () => hasDraft,
  });
beforeEach(() => {
  raw = null;
  other = null;
  hasDraft = false;
  writeFails = false;
  h.generation = 1;
  submit.mockClear();
});
it("persists exact bytes before submission and recovers a lost response after reopening", async () => {
  const queue = setup();
  queue.prepare(command);
  submit.mockRejectedValueOnce(Error("Lost response"));
  await expect(queue.resume(new AbortController().signal)).rejects.toThrow("Lost response");
  expect(setup().read()).toEqual(command);
  await setup().resume(new AbortController().signal);
  expect(submit.mock.calls.map((call) => call[0])).toEqual([command, command]);
  expect(queue.read()).toBeNull();
});
it("defers new operations while a manual draft or shared operation exists", () => {
  hasDraft = true;
  expect(setup().canPrepare()).toBe(false);
  expect(() => setup().prepare(command)).toThrow("saved canvas action");
  hasDraft = false;
  other = command;
  expect(setup().canPrepare()).toBe(false);
  expect(() => setup().prepare(command)).toThrow("saved canvas action");
  expect(raw).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});
it("rechecks manual drafts after encoding and refuses to overwrite an owned operation", () => {
  const queue = setup();
  expect(queue.canPrepare()).toBe(true);
  hasDraft = true;
  expect(() => queue.prepare(command)).toThrow();
  hasDraft = false;
  queue.prepare(command);
  queue.prepare(command);
  expect(() => queue.prepare({ ...command, yjsUpdateBase64: "AQI=" })).toThrow("already pending");
  expect(queue.read()).toEqual(command);
});
it("preserves both operations when another shared request owns the transport", async () => {
  setup().prepare(command);
  other = { ...command, yjsUpdateBase64: "AQI=" };
  await expect(setup().resume(new AbortController().signal)).rejects.toThrow("saved canvas action");
  expect(setup().read()).toEqual(command);
  expect(other.yjsUpdateBase64).toBe("AQI=");
  expect(submit).not.toHaveBeenCalled();
});
it("resumes its matching transport request even if a manual draft was created later", async () => {
  setup().prepare(command);
  other = command;
  hasDraft = true;
  await setup().resume(new AbortController().signal);
  expect(submit).toHaveBeenCalledOnce();
  expect(hasDraft).toBe(true);
  expect(setup().read()).toBeNull();
});
it("retains recovery bytes when storage cannot clear an acknowledged operation", async () => {
  setup().prepare(command);
  writeFails = true;
  await expect(setup().resume(new AbortController().signal)).rejects.toThrow("Storage full");
  writeFails = false;
  expect(setup().read()).toEqual(command);
  await setup().resume(new AbortController().signal);
  expect(submit.mock.calls.map((call) => call[0])).toEqual([command, command]);
});
it("aborts before sending and preserves an operation when the account retires after receipt", async () => {
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
  expect(JSON.parse(raw!).intent).toEqual(command);
});
it("does not replace corrupted recovery data or submit after persistence fails", () => {
  raw = "corrupt";
  expect(() => setup().canPrepare()).toThrow();
  expect(() => setup().prepare(command)).toThrow();
  expect(raw).toBe("corrupt");
  raw = null;
  writeFails = true;
  expect(() => setup().prepare(command)).toThrow("Storage full");
  expect(submit).not.toHaveBeenCalled();
});
