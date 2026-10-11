import { expect, it, vi } from "vitest";
import { createStoryTopUpReturnStore, storyTopUpReturnPath } from "./story-top-up-return";
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
function memory() {
  let value: string | null = null;
  return {
    read: () => value,
    write: (next: string) => {
      value = next;
    },
  };
}
it("recovers a destination only after a new launch without storing a payment command", () => {
  const storage = memory();
  const live = createStoryTopUpReturnStore(storage, "launch1");
  const entry = live.remember("film", "chapter2");
  expect(live.interrupted()).toBeNull();
  expect(createStoryTopUpReturnStore(storage, "launch2").interrupted()).toEqual(entry);
  expect(Object.keys(entry).sort()).toEqual(["chapterId", "gameId", "id", "session", "version"]);
});
it("does not clear a newer destination with an old acknowledgement", () => {
  const store = createStoryTopUpReturnStore(memory(), "launch");
  const first = store.remember("one");
  const second = store.remember("two");
  store.clear(first.id);
  expect(store.matches(second.id)).toBe(true);
});
it("clears only after arriving at the same film and chapter", () => {
  const storage = memory();
  const live = createStoryTopUpReturnStore(storage, "launch");
  const entry = live.remember("film", "two");
  live.arrived("other", "two");
  live.arrived("film", "one");
  expect(live.matches(entry.id)).toBe(true);
  live.arrived("film", "two");
  expect(createStoryTopUpReturnStore(storage, "next").interrupted()).toBeNull();
});
it("encodes film/chapter identity instead of accepting an arbitrary redirect", () => {
  const entry = createStoryTopUpReturnStore(memory(), "launch").remember("film/?#", "two&x=1");
  expect(storyTopUpReturnPath(entry)).toBe(
    "/play/interactive-film/film%2F%3F%23?chapter=two%26x%3D1"
  );
});
it("does not silently lose corrupt records or failed writes", () => {
  const storage = memory();
  storage.write("broken");
  expect(() => createStoryTopUpReturnStore(storage, "launch").interrupted()).toThrow();
  expect(() =>
    createStoryTopUpReturnStore(
      {
        read: () => null,
        write: () => {
          throw new Error("Full");
        },
      },
      "launch"
    ).remember("film")
  ).toThrow("Full");
});
