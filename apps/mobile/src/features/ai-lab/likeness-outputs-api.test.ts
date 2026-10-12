import { beforeEach, expect, it, vi } from "vitest";
import {
  loadLikenessOutputs,
  likenessTakedownBox,
  prepareLikenessTakedown,
  submitLikenessTakedown,
  previewLikenessOutput,
  type LikenessOutputJob,
  type TakedownScope,
} from "./likeness-outputs-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  access: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/features/crew-assets/api", () => ({ fetchCrewAssetAccess: h.access }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(ns + user + id) ?? null,
    write: (v: string) => h.records.set(ns + user + id, v),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  key = "33333333-3333-4333-8333-333333333333";
const job: LikenessOutputJob = {
  jobId: id,
  projectId: other,
  status: "completed",
  createdAt: "2026-01-01T00:00:00Z",
  outputs: [
    {
      assetId: key,
      url: "/aurora/media/assets/private/content",
      mimeType: "video/mp4",
      moderationStatus: "unknown",
    },
  ],
};
const command = (scope: TakedownScope = { kind: "all" }) =>
    prepareLikenessTakedown(id, "My likeness", [job], scope, key),
  signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.get.mockResolvedValue({ items: [job] });
  h.post.mockResolvedValue({ blocked: 1 });
  h.access.mockResolvedValue({ url: "https://media.test/signed" });
});
it("accepts official nullable output/project fields and rejects duplicate jobs", async () => {
  h.get.mockResolvedValueOnce({
    items: [
      {
        ...job,
        projectId: null,
        outputs: [{ assetId: null, url: null, mimeType: null, moderationStatus: "unknown" }],
      },
    ],
  });
  expect((await loadLikenessOutputs(id, 1, signal()))[0].projectId).toBeNull();
  h.get.mockResolvedValue({ items: [job, job] });
  await expect(loadLikenessOutputs(id, 1, signal())).rejects.toThrow("Duplicate");
});
it.each([
  { kind: "all" },
  { kind: "project", projectId: other },
  { kind: "job", jobId: id },
] as TakedownScope[])("uses exact reviewed scope %j and persists no media URLs", async (scope) => {
  h.post.mockImplementation(async (path, options) => {
    expect(path).toBe(`/characters/${id}/outputs/takedown`);
    expect(options.retry).toBe(false);
    expect(options.data).toEqual(
      scope.kind === "all" ? {} : scope.kind === "project" ? { projectId: other } : { jobId: id }
    );
    expect(likenessTakedownBox("actor", 1, id).read()).toEqual(command(scope));
    expect([...h.records.values()].join()).not.toContain("/aurora/media");
    return { blocked: 1 };
  });
  expect(await submitLikenessTakedown(command(scope), "actor", 1, signal())).toEqual({
    blocked: 1,
  });
  expect(likenessTakedownBox("actor", 1, id).read()).toBeNull();
});
it("requires stored assets and reconfirmation if target jobs/assets change", async () => {
  expect(() =>
    prepareLikenessTakedown(id, "My likeness", [{ ...job, outputs: [] }], { kind: "all" }, key)
  ).toThrow("No stored");
  for (const changed of [[], [{ ...job, outputs: [] }], [job, { ...job, jobId: key }]]) {
    h.get.mockResolvedValueOnce({ items: changed });
    await expect(submitLikenessTakedown(command(), "actor", 1, signal())).rejects.toThrow(
      "changed"
    );
  }
  expect(h.post).not.toHaveBeenCalled();
});
it("keeps lost requests across restart without automatic replay or guessed completion", async () => {
  h.post.mockRejectedValueOnce(new Error("Lost response"));
  await expect(submitLikenessTakedown(command(), "actor", 1, signal())).rejects.toThrow("Lost");
  expect(likenessTakedownBox("actor", 1, id).read()).not.toBeNull();
  expect(likenessTakedownBox("other", 1, id).read()).toBeNull();
  h.get.mockResolvedValue({ items: [] });
  await expect(submitLikenessTakedown(command(), "actor", 1, signal())).rejects.toThrow("original");
  await loadLikenessOutputs(id, 1, signal());
  expect(likenessTakedownBox("actor", 1, id).read()).not.toBeNull();
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("reports a zero/partial count as a receipt, never inventing blocked status", async () => {
  h.post.mockResolvedValue({ blocked: 0 });
  expect(await submitLikenessTakedown(command(), "actor", 1, signal())).toEqual({ blocked: 0 });
  expect((await loadLikenessOutputs(id, 1, signal()))[0].outputs[0].moderationStatus).toBe(
    "unknown"
  );
});
it("retains malformed or late receipts", async () => {
  h.post.mockResolvedValueOnce({ blocked: -1 });
  await expect(submitLikenessTakedown(command(), "actor", 1, signal())).rejects.toThrow();
  expect(likenessTakedownBox("actor", 1, id).read()).not.toBeNull();
  h.records.clear();
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return { blocked: 1 };
  });
  await expect(submitLikenessTakedown(command(), "actor", 1, signal())).rejects.toThrow();
  h.generation = 1;
  expect(likenessTakedownBox("actor", 1, id).read()).not.toBeNull();
});
it("rechecks subject scope then obtains authorized preview access without using raw URLs", async () => {
  expect(await previewLikenessOutput(id, id, key, 1, signal())).toEqual({
    url: "https://media.test/signed",
    mimeType: "video/mp4",
  });
  expect(h.access).toHaveBeenCalledWith(key, expect.any(AbortSignal));
  h.access.mockClear();
  for (const rows of [
    [],
    [{ ...job, outputs: [{ ...job.outputs[0], moderationStatus: "blocked" }] }],
  ]) {
    h.get.mockResolvedValueOnce({ items: rows });
    await expect(previewLikenessOutput(id, id, key, 1, signal())).rejects.toThrow("no longer");
  }
  expect(h.access).not.toHaveBeenCalled();
  h.get.mockRejectedValueOnce(new Error("Subject denied"));
  await expect(previewLikenessOutput(id, id, key, 1, signal())).rejects.toThrow("Subject denied");
  expect(h.access).not.toHaveBeenCalled();
  h.access.mockRejectedValueOnce(new Error("Media denied"));
  await expect(previewLikenessOutput(id, id, key, 1, signal())).rejects.toThrow("Media denied");
});
