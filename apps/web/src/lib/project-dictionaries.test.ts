import { afterEach, beforeEach, expect, it, vi } from "vitest";
const get = vi.hoisted(() => vi.fn());
vi.mock("@/src/lib/api", () => ({ backendApi: { get } }));
import { fetchProjectDictionaries } from "./project-dictionaries";
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  get.mockReset();
  get.mockImplementation((path: string) =>
    Promise.resolve(
      path.includes("product-types")
        ? { "1": "Type" }
        : path.includes("painting-styles")
          ? [{ id: 1, info: "Style" }]
          : { AspectRatioTypeEnum: { wide: "Wide" } }
    )
  );
});
it("preserves partial results but fetches complete configuration on the next call", async () => {
  get.mockRejectedValueOnce(new Error("Unavailable"));
  const partial = await fetchProjectDictionaries();
  expect(partial.typeOptions).toEqual([]);
  expect(partial.styleOptions).toHaveLength(1);
  const result = await fetchProjectDictionaries();
  expect(result.typeOptions).toEqual([{ value: 1, label: "Type" }]);
  expect(result.styleOptions).toHaveLength(1);
  expect(result.sizeOptions).toHaveLength(1);
  expect(get).toHaveBeenCalledTimes(6);
});
it("does not reuse another caller's configuration or cancellation", async () => {
  const first = new AbortController();
  await fetchProjectDictionaries(first.signal);
  first.abort();
  const second = new AbortController();
  await fetchProjectDictionaries(second.signal);
  expect(get).toHaveBeenCalledTimes(6);
  expect(get.mock.calls.slice(3).every((call) => call[1].signal === second.signal)).toBe(true);
});
it("rejects late configuration after cancellation and avoids already-aborted reads", async () => {
  let release!: (value: object) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const controller = new AbortController();
  const pending = fetchProjectDictionaries(controller.signal);
  controller.abort();
  release({ "1": "Late" });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(fetchProjectDictionaries(controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(get).toHaveBeenCalledTimes(3);
});

afterEach(() => vi.restoreAllMocks());
it("preserves rejection when all dictionaries fail", async () => {
  get.mockRejectedValue(new Error("offline"));
  await expect(fetchProjectDictionaries()).rejects.toThrow(
    "Failed to load all project dictionaries"
  );
});
