import { afterEach, expect, it, vi } from "vitest";
import { useSparkAnalyze } from "./use-spark";
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: { mutationFn: unknown }) => ({ mutateAsync: options.mutationFn }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const file = new File(["brief"], "brief.txt");
it("keeps the timeout active during body reading", async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return Promise.resolve({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), { once: true })
          ),
      });
    })
  );
  const pending = useSparkAnalyze().mutateAsync(file);
  const rejection = expect(pending).rejects.toThrow("Analysis timed out");
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(300_000);
  await rejection;
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("forwards caller cancellation and prevents already cancelled starts", async () => {
  const caller = new AbortController();
  let signal!: AbortSignal;
  const fetchMock = vi.fn((_url, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const pending = useSparkAnalyze().mutateAsync({ file, signal: caller.signal });
  const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  caller.abort();
  await rejection;
  expect(signal.aborted).toBe(true);
  await expect(
    useSparkAnalyze().mutateAsync({ file, signal: caller.signal })
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("retains supported success envelopes and releases timeout/listener resources", async () => {
  vi.useFakeTimers();
  const caller = new AbortController();
  const remove = vi.spyOn(caller.signal, "removeEventListener");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { name: "Draft" } })))
  );
  expect(await useSparkAnalyze().mutateAsync({ file, signal: caller.signal })).toEqual({
    name: "Draft",
  });
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves the server explanation when upload analysis fails with HTTP 400", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ message: "Could not read any text from the uploaded file." }),
          { status: 400 }
        )
      )
  );
  await expect(useSparkAnalyze().mutateAsync(file)).rejects.toThrow(
    "Could not read any text from the uploaded file."
  );
});
