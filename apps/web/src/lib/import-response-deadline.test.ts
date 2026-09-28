import { afterEach, expect, it, vi } from "vitest";
import { formatImportedEntityExcel } from "./import-entity";
import { formatStoryboardExcel } from "./storyboard-export";
vi.mock("@/src/lib/api", () => ({ backendApi: { post: vi.fn() } }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const readers = [
  () => formatImportedEntityExcel("role", new File(["sheet"], "roles.xlsx")),
  () => formatStoryboardExcel(new File(["sheet"], "shots.xlsx")),
];
it.each(readers)(
  "keeps the import deadline active while reading the response body",
  async (read) => {
    vi.useFakeTimers();
    let finish!: (body: unknown) => void;
    const body = new Promise((resolve) => {
      finish = resolve;
    });
    const request = vi.fn().mockResolvedValue({ ok: true, json: () => body });
    vi.stubGlobal("fetch", request);
    const pending = read();
    const rejected = expect(pending).rejects.toThrow("Request timed out");
    await vi.advanceTimersByTimeAsync(600_000);
    finish({ code: 200, data: [["late"]] });
    await rejected;
    expect(request.mock.calls[0]![1].signal.aborted).toBe(true);
  }
);
it.each(readers)("preserves valid imported rows and releases the deadline", async (read) => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: [["current"]] })))
  );
  await expect(read()).resolves.toEqual([["current"]]);
  expect(vi.getTimerCount()).toBe(0);
});
