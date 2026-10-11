import { beforeEach, expect, it, vi } from "vitest";
import { timelinePending, type PendingTimeline } from "./story-timeline-pending";
const h = vi.hoisted(() => ({ generation: 1, save: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("./story-timeline-api", () => ({ saveTimeline: h.save }));
const id = "00000000-0000-4000-8000-000000000001";
const scope = { projectId: id, chapterId: id, generation: 1 };
const command: PendingTimeline = {
  version: 1,
  sequenceId: id,
  clientKey: id,
  input: { expectedVersion: 2, durationMs: 0, clips: [] },
};
let raw: string | null;
const storage = {
  read: () => raw,
  write: (value: string) => {
    raw = value;
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  raw = null;
});
it("persists before dispatch and clears only after a verified save", async () => {
  h.save.mockImplementation(async () => {
    expect(JSON.parse(raw!)).toEqual(command);
    return { version: 3 };
  });
  await expect(timelinePending(scope, "user", storage).submit(command)).resolves.toEqual({
    version: 3,
  });
  expect(raw).toBe("null");
});
it("recovers the exact command across store instances after network failure", async () => {
  h.save.mockRejectedValueOnce(Error("Network"));
  await expect(timelinePending(scope, "user", storage).submit(command)).rejects.toThrow("Network");
  const reopened = timelinePending(scope, "user", storage);
  expect(reopened.read()).toEqual(command);
  h.save.mockResolvedValue({ version: 3 });
  await reopened.submit(reopened.read()!);
  expect(h.save.mock.calls[0]).toEqual(h.save.mock.calls[1]);
});
it("does not send if persistence fails", async () => {
  const store = timelinePending(scope, "user", {
    read: () => null,
    write: () => {
      throw Error("Storage full");
    },
  });
  await expect(store.submit(command)).rejects.toThrow("Storage full");
  expect(h.save).not.toHaveBeenCalled();
});
it("refuses to replace a different pending command", () => {
  const store = timelinePending(scope, "user", storage);
  store.save(command);
  expect(() =>
    store.save({ ...command, input: { ...command.input, expectedVersion: 3 } })
  ).toThrow();
  expect(store.read()).toEqual(command);
});
it("blocks clearing a different request and stale account access", () => {
  const store = timelinePending(scope, "user", storage);
  store.save(command);
  expect(() => store.clear("other")).toThrow();
  h.generation = 2;
  expect(() => store.read()).toThrow();
  expect(() => store.clear(command.clientKey)).toThrow();
  expect(raw).not.toBe("null");
});
it("does not silently overwrite corrupt recovery data", () => {
  raw = "corrupt";
  const store = timelinePending(scope, "user", storage);
  expect(() => store.save(command)).toThrow();
  expect(raw).toBe("corrupt");
});
