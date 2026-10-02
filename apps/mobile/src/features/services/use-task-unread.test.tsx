import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useTaskUnread } from "./use-task-unread";
const h = vi.hoisted(() => ({ load: vi.fn(), generation: 1 }));
vi.mock("./task-unread-api", () => ({ fetchTaskUnread: h.load }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ active = true, generation = 1 }: { active?: boolean; generation?: number }) {
  const data = useTaskUnread(active, generation);
  return (
    <div>
      {JSON.stringify(data.counts)}
      {data.error}
      <button onClick={data.refresh}>refresh</button>
    </div>
  );
}
const render = (active = true, generation = 1) =>
  act(async () => root.render(<Probe active={active} generation={generation} />));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  host = document.createElement("div");
  root = createRoot(host);
  h.load.mockResolvedValue({ task: 3 });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it("polls once per minute only while visible and refreshes on return", async () => {
  vi.useFakeTimers();
  await render();
  expect(host.textContent).toContain('"task":3');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(h.load).toHaveBeenCalledTimes(2);
  const signal = h.load.mock.calls[1][1] as AbortSignal;
  await render(false);
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain('"task"');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(h.load).toHaveBeenCalledTimes(2);
  await render();
  expect(h.load).toHaveBeenCalledTimes(3);
});
it("clears stale counts after failures and retries only when requested", async () => {
  vi.useFakeTimers();
  await render();
  h.load.mockRejectedValueOnce(new Error("Access revoked"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(host.textContent).toContain("Access revoked");
  expect(host.textContent).not.toContain('"task"');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(h.load).toHaveBeenCalledTimes(2);
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain('"task":3');
});
it("ignores a previous account's response and prevents overlapping polling", async () => {
  vi.useFakeTimers();
  let resolve!: (value: unknown) => void;
  h.load.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(h.load).toHaveBeenCalledOnce();
  h.generation = 2;
  h.load.mockResolvedValue({ newTask: 1 });
  await render(true, 2);
  await act(async () => resolve({ oldTask: 99 }));
  expect(host.textContent).toContain('"newTask":1');
  expect(host.textContent).not.toContain("oldTask");
});

it("does not restore old unread badges before the return request completes", async () => {
  let finish!: (value: unknown) => void;
  await render();
  await render(false);
  h.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  expect(host.textContent).not.toContain('"task":3');
  await act(async () => finish({ task: 0 }));
  expect(host.textContent).toContain('"task":0');
});
