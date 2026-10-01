import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useInboxRealtime } from "./use-inbox-realtime";
const h = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn(), refresh: vi.fn() }));
vi.mock("./inbox-realtime", () => ({ openInboxRealtime: h.open }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ active = true, generation = 1 }: { active?: boolean; generation?: number }) {
  const failed = useInboxRealtime("1", generation, active, h.refresh);
  return <span>{failed ? "offline" : "ready"}</span>;
}
const render = (active = true, generation = 1) =>
  act(async () => root.render(<Probe active={active} generation={generation} />));
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  h.open.mockReturnValue(h.close);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("coalesces bursts and cancels refresh/connection on background", async () => {
  await render();
  const invalidate = h.open.mock.calls[0][2];
  await act(async () => {
    invalidate();
    invalidate();
    vi.advanceTimersByTime(250);
  });
  expect(h.refresh).toHaveBeenCalledTimes(1);
  await act(async () => invalidate());
  await render(false);
  await act(async () => vi.advanceTimersByTime(500));
  expect(h.close).toHaveBeenCalledOnce();
  expect(h.refresh).toHaveBeenCalledTimes(1);
  await render(true);
  expect(h.open).toHaveBeenCalledTimes(2);
});
it("isolates account failures and reports recovery", async () => {
  await render();
  await act(async () => h.open.mock.calls[0][3]());
  expect(host.textContent).toBe("offline");
  await render(true, 2);
  expect(host.textContent).toBe("ready");
  expect(h.close).toHaveBeenCalledOnce();
  await act(async () => h.open.mock.calls[0][3]());
  expect(host.textContent).toBe("ready");
  await act(async () => h.open.mock.calls[1][3]());
  expect(host.textContent).toBe("offline");
  await act(async () => h.open.mock.calls[1][2]());
  expect(host.textContent).toBe("ready");
});
