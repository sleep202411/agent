import { beforeEach, expect, it, vi } from "vitest";
import type { ShotRow } from "@/src/store/slices/projectSlice";
const s = vi.hoisted(() => ({
  project: "p",
  detail: { id: "p" },
  episode: "e",
  rows: [
    { shotId: "shot", shotValues: [{ shotColumnId: "column", value: "initial", id: "initial" }] },
  ] as ShotRow[],
  post: vi.fn(),
  dispatch: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/env", () => ({ env: { OSS_BASE_URL: "https://assets.invalid" } }));
vi.mock("sonner", () => ({ toast: { error: s.error } }));
vi.mock("@/src/lib/api", () => ({ backendApi: { post: s.post } }));
vi.mock("@/src/store", () => ({
  store: { getState: () => ({ project: { currentProjectId: s.project } }), dispatch: s.dispatch },
}));
vi.mock("@/src/store/slices/projectSlice", () => ({
  selectCurrentInstance: () => ({
    detail: s.detail,
    activeEpisodeId: s.episode,
    rows: s.rows,
    columns: [{ id: "column" }],
  }),
  setRows: (rows: typeof s.rows) => ({ type: "rows", payload: rows }),
  touchStoryboard: () => ({ type: "refresh" }),
}));
import { persistTextCell, persistValueList } from "./cell-utils";
const pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
beforeEach(() => {
  s.project = "p";
  s.detail = { id: "p" };
  s.episode = "e";
  s.rows = [
    { shotId: "shot", shotValues: [{ shotColumnId: "column", value: "initial", id: "initial" }] },
  ];
  pending.length = 0;
  s.error.mockReset();
  s.dispatch.mockReset().mockImplementation((action) => {
    if (action.type === "rows") s.rows = action.payload;
  });
  s.post
    .mockReset()
    .mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
});
it("does not attach a late acknowledgement to a replacement project", async () => {
  const work = persistTextCell("shot", "column", "old");
  s.project = "q";
  s.detail = { id: "q" };
  s.dispatch.mockClear();
  pending[0].resolve("server-id");
  await work;
  expect(s.dispatch).not.toHaveBeenCalled();
});
it("keeps the newer cell edit when acknowledgements arrive out of order", async () => {
  const first = persistTextCell("shot", "column", "first");
  const second = persistTextCell("shot", "column", "second");
  pending[1].resolve("new-id");
  await second;
  pending[0].resolve("old-id");
  await first;
  expect(s.rows[0].shotValues![0]).toMatchObject({ value: "second", id: "new-id" });
});
it("does not refresh or toast a departed episode after an old failure", async () => {
  const work = persistTextCell("shot", "column", "old");
  s.episode = "other";
  s.dispatch.mockClear();
  pending[0].reject(new Error("late failure"));
  await work;
  expect(s.error).not.toHaveBeenCalled();
  expect(s.dispatch).not.toHaveBeenCalled();
});
it("preserves active failure feedback and subsequent retry", async () => {
  const work = persistTextCell("shot", "column", "retry");
  pending[0].reject(new Error("offline"));
  await work;
  expect(s.error).toHaveBeenCalledTimes(1);
  expect(s.dispatch).toHaveBeenCalledWith({ type: "refresh" });
  const retry = persistTextCell("shot", "column", "retry");
  pending[1].resolve("ok");
  await retry;
  expect(s.rows[0].shotValues![0].id).toBe("ok");
});
it("keeps silent autosave network-only", async () => {
  const work = persistTextCell("shot", "column", "silent", { silent: true });
  pending[0].resolve("ok");
  await work;
  expect(s.dispatch).not.toHaveBeenCalled();
  expect(s.error).not.toHaveBeenCalled();
});

it("preserves an external cell edit that arrives while the save is pending", async () => {
  const work = persistTextCell("shot", "column", "old");
  s.rows[0].shotValues![0].value = "external";
  s.dispatch.mockClear();
  pending[0].resolve("old-id");
  await work;
  expect(s.dispatch).not.toHaveBeenCalled();
  expect(s.rows[0].shotValues![0].value).toBe("external");
});
it("does not recreate a deleted shot after acknowledgement", async () => {
  const work = persistTextCell("shot", "column", "old");
  s.rows = [];
  s.dispatch.mockClear();
  pending[0].resolve("old-id");
  await work;
  expect(s.dispatch).not.toHaveBeenCalled();
});

it("keeps replacement media values when the older save finishes last", async () => {
  const first = persistValueList("shot", "column", ["old"], {});
  const second = persistValueList("shot", "column", ["new"], {});
  pending[1].resolve("new-id");
  await second;
  pending[0].resolve("old-id");
  await first;
  expect(s.rows[0].shotValues![0]).toMatchObject({ values: ["new"], id: "new-id" });
});
it("suppresses media acknowledgement and failure after project departure", async () => {
  const first = persistValueList("shot", "column", ["old"], {});
  s.project = "other";
  s.dispatch.mockClear();
  pending[0].resolve("old-id");
  await first;
  expect(s.dispatch).not.toHaveBeenCalled();
  s.project = "p";
  const second = persistValueList("shot", "column", ["old"], {});
  s.episode = "other";
  s.dispatch.mockClear();
  pending[1].reject(new Error("old failure"));
  await second;
  expect(s.dispatch).not.toHaveBeenCalled();
  expect(s.error).not.toHaveBeenCalled();
});
it("retains active media failure feedback and retry", async () => {
  const first = persistValueList("shot", "column", ["asset"], {});
  pending[0].reject(new Error("offline"));
  await first;
  expect(s.error).toHaveBeenCalledTimes(1);
  const second = persistValueList("shot", "column", ["asset"], {});
  pending[1].resolve("ok");
  await second;
  expect(s.rows[0].shotValues![0].id).toBe("ok");
});
