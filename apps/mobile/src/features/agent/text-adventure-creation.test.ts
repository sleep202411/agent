import { beforeEach, expect, it, vi } from "vitest";
import { textAdventureCreation } from "./text-adventure-creation";
const h = vi.hoisted(() => ({
  raw: null as string | null,
  generation: 1,
  write: vi.fn(),
  upload: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: () => ({
    read: () => h.raw,
    write: (v: string) => {
      h.write(v);
      h.raw = v;
    },
  }),
}));
vi.mock("@/lib/durable-record-key", () => ({ durableRecordKey: () => "test" }));
vi.mock("./text-adventure-create-lock", async () => import("./text-adventure-create-lock.native"));
vi.mock("./text-adventure-upload", () => ({ pickAndUploadTextAdventureMedia: h.upload }));
vi.mock("./api/text-adventure-api", () => ({
  createTextAdventure: h.create,
  listTextAdventures: h.list,
  getTextAdventure: h.get,
}));
const session = { userId: "1", generation: 1 };
const workflow = () => textAdventureCreation(session);
const signal = () => new AbortController().signal;
const gameId = "tg_0123456789abcdef";
const source = "https://cdn.example/unique-world.docx";
const ready = async () => (await workflow().select(signal()))!;
beforeEach(() => {
  vi.resetAllMocks();
  h.raw = null;
  h.generation = 1;
  h.upload.mockResolvedValue({ name: "world.docx", url: source });
  h.create.mockResolvedValue({ gameId });
  h.list.mockResolvedValue([]);
});
it("persists an uploaded document without creating, restores it, and creates only explicitly", async () => {
  const r = await ready();
  expect(h.create).not.toHaveBeenCalled();
  expect(workflow().read()).toEqual(r);
  h.create.mockImplementation(async () => {
    expect(workflow().read()?.phase).toBe("creating");
    return { gameId };
  });
  await workflow().create(r.id, signal());
  expect(workflow().read()).toMatchObject({ phase: "created", gameId });
  expect(h.create).toHaveBeenCalledWith(
    { worldviewDocxUrl: source },
    session,
    expect.any(AbortSignal)
  );
  await expect(workflow().create(r.id, signal())).rejects.toThrow("existing creation");
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("retains an unknown result and recovers by exact document URL without another POST", async () => {
  const r = await ready();
  h.create.mockRejectedValue(new Error("Response lost"));
  await expect(workflow().create(r.id, signal())).rejects.toThrow("Response lost");
  expect(workflow().read()?.phase).toBe("creating");
  await expect(workflow().create(r.id, signal())).rejects.toThrow("existing creation");
  h.list.mockResolvedValue([{ gameId }]);
  h.get.mockResolvedValue({ gameId, content: { worldviewDocxUrl: source } });
  expect(await workflow().recover(r.id, signal())).toMatchObject({ phase: "created", gameId });
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("does not resubmit when recovery has no match or ambiguous matches", async () => {
  const r = await ready();
  h.create.mockRejectedValue(new Error("lost"));
  await expect(workflow().create(r.id, signal())).rejects.toThrow();
  expect((await workflow().recover(r.id, signal())).phase).toBe("creating");
  h.list.mockResolvedValue([{ gameId }, { gameId: "tg_fedcba9876543210" }]);
  h.get.mockImplementation(async (id: string) => ({
    gameId: id,
    content: { worldviewDocxUrl: source },
  }));
  await expect(workflow().recover(r.id, signal())).rejects.toThrow("Multiple works");
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(workflow().read()?.phase).toBe("creating");
});
it("refuses dispatch when durable intent cannot be saved", async () => {
  const r = await ready();
  h.write.mockImplementation(() => {
    throw new Error("Disk full");
  });
  await expect(workflow().create(r.id, signal())).rejects.toThrow("Disk full");
  expect(h.create).not.toHaveBeenCalled();
  expect(workflow().read()?.phase).toBe("ready");
});
it("rejects stale UI records and requires explicit acknowledgement to clear unknown creation", async () => {
  const r = await ready();
  await expect(workflow().create("stale", signal())).rejects.toThrow(
    "pending text adventure changed"
  );
  h.create.mockRejectedValue(new Error("lost"));
  await expect(workflow().create(r.id, signal())).rejects.toThrow();
  await expect(workflow().discard(r.id)).rejects.toThrow("may have completed");
  await workflow().discard(r.id, true);
  expect(workflow().read()).toBeNull();
});
it("blocks overlapping creation and ignores an aborted late success while retaining recovery intent", async () => {
  const r = await ready();
  const c = new AbortController();
  let resolve!: (value: { gameId: string }) => void;
  h.create.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const pending = workflow().create(r.id, c.signal);
  await expect(workflow().create(r.id, signal())).rejects.toThrow("already running");
  c.abort();
  resolve({ gameId });
  await expect(pending).rejects.toThrow();
  expect(workflow().read()?.phase).toBe("creating");
});
it("rejects account switches after upload", async () => {
  h.upload.mockImplementation(async () => {
    h.generation = 2;
    return { name: "world.docx", url: source };
  });
  await expect(ready()).rejects.toThrow("account changed");
  expect(h.raw).toBeNull();
});
it("cancellation does not persist a new record", async () => {
  h.upload.mockResolvedValue(null);
  expect(await workflow().select(signal())).toBeNull();
  expect(h.raw).toBeNull();
  expect(h.create).not.toHaveBeenCalled();
});
