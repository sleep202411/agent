import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useNotificationUnreadCount } from "./use-notification-unread-count";
import { notificationReadConfirmed } from "./notification-read-events";
const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./notification-api", () => ({ fetchNotificationUnreadCount: h.load }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Probe({ generation }: { generation?: number }) {
  const state = useNotificationUnreadCount(generation);
  return (
    <div>
      {state.loading ? "Loading" : (state.error ?? state.count)}
      <button onClick={state.refresh}>Retry</button>
    </div>
  );
}
const render = (generation?: number) =>
  act(async () => root.render(<Probe generation={generation} />));
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
it("refreshes matching receipts and polls only while active", async () => {
  h.load.mockResolvedValue(4);
  await render(1);
  expect(host.textContent).toContain("4");
  await act(async () => notificationReadConfirmed(2));
  expect(h.load).toHaveBeenCalledTimes(1);
  h.load.mockResolvedValue(0);
  await act(async () => notificationReadConfirmed(1));
  expect(host.textContent).toContain("0");
  await act(async () => vi.advanceTimersByTime(60000));
  expect(h.load).toHaveBeenCalledTimes(3);
  await render();
  await act(async () => {
    vi.advanceTimersByTime(60000);
    notificationReadConfirmed(1);
  });
  expect(h.load).toHaveBeenCalledTimes(3);
});
it("rejects late old scopes and does not restore an earlier count on return", async () => {
  let finish!: (n: number) => void;
  h.load
    .mockResolvedValueOnce(5)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        })
    )
    .mockResolvedValueOnce(2);
  await render(1);
  await render(2);
  const signal = h.load.mock.calls[1][1];
  await render(1);
  expect(signal.aborted).toBe(true);
  await act(async () => finish(99));
  expect(host.textContent).toBe("2Retry");
});
it("keeps failures unknown and retries explicitly", async () => {
  h.load.mockRejectedValueOnce(Error("Offline")).mockResolvedValueOnce(3);
  await render(1);
  expect(host.textContent).toBe("OfflineRetry");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toBe("3Retry");
});
