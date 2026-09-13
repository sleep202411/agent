import { expect, it, vi } from "vitest";
import { recommendViewing } from "./recommend.js";
const id = "11111111-1111-4111-8111-111111111111";
const request = {
  preference: "A calm adventure",
  locale: "en-US",
  candidates: [{ id, title: "Journey", summary: "A quiet walk" }],
};
it("selects only catalog identities without tools or private context", async () => {
  const invoke = vi
    .fn()
    .mockResolvedValue(JSON.stringify({ suggestions: [{ id, reason: "A quiet journey" }] }));
  expect(await recommendViewing(request, invoke, new AbortController().signal)).toEqual({
    suggestions: [{ id, reason: "A quiet journey" }],
  });
  expect(invoke.mock.calls[0][0]).toHaveLength(2);
  expect(JSON.parse(invoke.mock.calls[0][0][1].content)).toEqual(request);
});
it.each([
  { suggestions: [{ id: "22222222-2222-4222-8222-222222222222", reason: "Invented" }] },
  {
    suggestions: [
      { id, reason: "one" },
      { id, reason: "two" },
    ],
  },
  { suggestions: [{ id, reason: "one", url: "https://example.com/private" }] },
])("rejects untrusted output %j", async (reply) => {
  await expect(
    recommendViewing(
      request,
      vi.fn().mockResolvedValue(JSON.stringify(reply)),
      new AbortController().signal
    )
  ).rejects.toThrow();
});
it("skips model work for an empty catalog or an abandoned request", async () => {
  const invoke = vi.fn();
  const c = new AbortController();
  expect(await recommendViewing({ ...request, candidates: [] }, invoke, c.signal)).toEqual({
    suggestions: [],
  });
  c.abort();
  await expect(recommendViewing(request, invoke, c.signal)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
it("rejects a late model response after cancellation", async () => {
  let finish!: (value: string) => void;
  const c = new AbortController();
  const pending = recommendViewing(
    request,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    c.signal
  );
  c.abort();
  finish(JSON.stringify({ suggestions: [{ id, reason: "late" }] }));
  await expect(pending).rejects.toThrow();
});

it("releases cancellation even when the model never settles", async () => {
  const controller = new AbortController();
  const pending = recommendViewing(request, () => new Promise(() => {}), controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow();
});
