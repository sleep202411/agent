import { beforeEach, expect, it, vi } from "vitest";
import { storyCandidates } from "./story-candidates-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), delete: vi.fn(), put: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, delete: h.delete, put: h.put } }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), generation: 1 };
const command = { clientKey: id(2), mediaAssetId: id(3) };
const candidate = {
  asset: {
    id: id(3),
    kind: "image",
    status: "ready",
    moderationStatus: "approved",
    contentType: "image/png",
    previewUrl: null,
  },
};
let raw: string | null, rows: unknown[], project: { id: string; capabilities: string[] };
const storage = {
  read: () => raw,
  write: (value: string) => {
    raw = value;
  },
};
const signal = () => new AbortController().signal;
const client = () => storyCandidates(scope, "user", storage);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  raw = null;
  rows = [candidate];
  project = { id: id(1), capabilities: ["story.read", "story.edit"] };
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("candidate-assets") ? rows : project
  );
  h.delete.mockImplementation(async () => {
    rows = [];
    return { mediaAssetId: id(3) };
  });
});
it("lists image, video and audio candidates without filtering away unusable saved entries", async () => {
  rows = [
    candidate,
    { asset: { ...candidate.asset, id: id(4), kind: "audio" } },
    { asset: { ...candidate.asset, id: id(5), kind: "video", status: "failed" } },
  ];
  expect((await client().load(signal())).items).toEqual(rows);
});
it("persists removal before dispatch and confirms its absence before clearing", async () => {
  h.delete.mockImplementation(async (path, options) => {
    expect(JSON.parse(raw!).intent).toEqual(command);
    expect(path).toBe(`/story-projects/${id(1)}/candidate-assets/${id(3)}`);
    expect(options).toMatchObject({ service: "aurora", retry: false });
    rows = [];
    return { mediaAssetId: id(3) };
  });
  expect(await client().remove(command, signal())).toMatchObject({ items: [], pending: null });
  expect(client().pending()).toBeNull();
});
it("retains a lost removal receipt even when the filtered list omits the media", async () => {
  h.delete.mockImplementation(async () => {
    rows = [];
    throw Error("Connection lost");
  });
  await expect(client().remove(command, signal())).rejects.toThrow("Connection lost");
  expect(client().pending()).toEqual(command);
  expect((await client().load(signal())).pending).toEqual(command);
  h.delete.mockResolvedValue({ mediaAssetId: id(3) });
  await client().remove(command, signal());
  expect(client().pending()).toBeNull();
  expect(h.delete).toHaveBeenCalledTimes(2);
});
it("keeps a failed removal and retries the same target", async () => {
  h.delete.mockRejectedValueOnce(Error("Offline"));
  await expect(client().remove(command, signal())).rejects.toThrow("Offline");
  await client().remove(client().pending()!, signal());
  expect(client().pending()).toBeNull();
  expect(h.delete.mock.calls[0][0]).toBe(h.delete.mock.calls[1][0]);
});
it("rejects revoked editing permission before writing", async () => {
  project.capabilities = ["story.read"];
  expect((await client().load(signal())).canEdit).toBe(false);
  await expect(client().remove(command, signal())).rejects.toThrow("editing permission");
  expect(h.delete).not.toHaveBeenCalled();
  expect(raw).toBeNull();
});
it("rejects foreign project, missing read permission and duplicate media", async () => {
  project.id = id(8);
  await expect(client().load(signal())).rejects.toThrow("identity");
  project.id = id(1);
  project.capabilities = [];
  await expect(client().load(signal())).rejects.toThrow("reading permission");
  project.capabilities = ["story.read"];
  rows = [candidate, candidate];
  await expect(client().load(signal())).rejects.toThrow("Duplicate");
});
it("retains intent on mismatched receipts and removes it only after authoritative reconciliation", async () => {
  h.delete.mockResolvedValue({ mediaAssetId: id(8) });
  await expect(client().remove(command, signal())).rejects.toThrow("verified");
  expect((await client().load(signal())).pending).toEqual(command);
  rows = [];
  expect((await client().load(signal())).pending).toEqual(command);
});
it("uses the authoritative matching delete receipt even if a concurrent addition is listed", async () => {
  h.delete.mockResolvedValue({ mediaAssetId: id(3) });
  await client().remove(command, signal());
  expect(client().pending()).toBeNull();
});
it("prevents replacing an unresolved command", async () => {
  h.delete.mockRejectedValueOnce(Error("Offline"));
  await expect(client().remove(command, signal())).rejects.toThrow();
  await expect(
    client().remove({ clientKey: id(9), mediaAssetId: id(4) }, signal())
  ).rejects.toThrow("pending");
  expect(h.delete).toHaveBeenCalledOnce();
});
it("blocks failed storage, stale sessions and aborts", async () => {
  await expect(
    storyCandidates(scope, "user", {
      read: () => null,
      write: () => {
        throw Error("Full");
      },
    }).remove(command, signal())
  ).rejects.toThrow("Full");
  h.generation = 2;
  await expect(client().load(signal())).rejects.toThrow("expired");
  h.generation = 1;
  const c = new AbortController();
  c.abort();
  await expect(client().remove(command, c.signal)).rejects.toThrow();
  expect(h.delete).not.toHaveBeenCalled();
});
it("rejects account changes during requests", async () => {
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return project;
  });
  await expect(client().load(signal())).rejects.toThrow("expired");
  expect(h.delete).not.toHaveBeenCalled();
});

it("preserves intent if the panel closes after dispatch and reconciles on return", async () => {
  const c = new AbortController();
  h.delete.mockImplementation(async () => {
    rows = [];
    c.abort();
    return { mediaAssetId: id(3) };
  });
  await expect(client().remove(command, c.signal)).rejects.toThrow();
  expect(client().pending()).toEqual(command);
  expect((await client().load(signal())).pending).toEqual(command);
  h.delete.mockResolvedValue({ mediaAssetId: id(3) });
  await client().remove(command, signal());
  expect(client().pending()).toBeNull();
  expect(h.delete).toHaveBeenCalledTimes(2);
});
it("serializes rapid removal requests", async () => {
  let finish!: (value: unknown) => void;
  h.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const service = client();
  const first = service.remove(command, signal());
  await expect(service.remove(command, signal())).rejects.toThrow("in progress");
  finish(project);
  await first;
  expect(h.delete).toHaveBeenCalledOnce();
});

it("saves existing media with official PUT and preserves intent until membership is verified", async () => {
  rows = [];
  const add = { ...command, action: "add" as const };
  h.put.mockImplementation(async (path, options) => {
    expect(JSON.parse(raw!).intent).toEqual(add);
    expect(path).toBe(`/story-projects/${id(1)}/candidate-assets/${id(3)}`);
    expect(options).toMatchObject({ service: "aurora", retry: false });
    rows = [candidate];
    return candidate;
  });
  expect((await client().submit(add, signal())).pending).toBeNull();
  expect(h.delete).not.toHaveBeenCalled();
});
it("reconciles a lost addition without adding again, including after editing permission is revoked", async () => {
  rows = [];
  h.put.mockImplementation(async () => {
    rows = [candidate];
    throw Error("Reply lost");
  });
  await expect(client().submit({ ...command, action: "add" }, signal())).rejects.toThrow(
    "Reply lost"
  );
  project.capabilities = ["story.read"];
  expect((await client().load(signal())).pending).toBeNull();
  expect(h.put).toHaveBeenCalledOnce();
});
it("does not repeat already saved additions or permit new ones without edit permission", async () => {
  await client().submit({ ...command, action: "add" }, signal());
  expect(h.put).not.toHaveBeenCalled();
  rows = [];
  project.capabilities = ["story.read"];
  await expect(client().submit({ ...command, action: "add" }, signal())).rejects.toThrow(
    "editing permission"
  );
  expect(h.put).not.toHaveBeenCalled();
});
it("retains failed additions and permits explicit local cancellation without deleting media", async () => {
  rows = [];
  h.put.mockRejectedValue(Error("Media was blocked by moderation"));
  await expect(client().submit({ ...command, action: "add" }, signal())).rejects.toThrow(
    "blocked by moderation"
  );
  expect(client().pending()).toMatchObject({ action: "add" });
  client().discard(command.clientKey);
  expect(client().pending()).toBeNull();
  expect(h.delete).not.toHaveBeenCalled();
});
it("rejects mismatched addition receipts and preserves exact target", async () => {
  rows = [];
  h.put.mockResolvedValue({ asset: { ...candidate.asset, id: id(9) } });
  await expect(client().submit({ ...command, action: "add" }, signal())).rejects.toThrow(
    "verified"
  );
  expect(client().pending()).toEqual({ ...command, action: "add" });
});
