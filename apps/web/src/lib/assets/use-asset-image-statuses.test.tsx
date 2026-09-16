import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useAssetImageStatuses,
  type UseAssetImageStatusesResult,
} from "./use-asset-image-statuses";
import { fetchAssetImageStatuses, type AssetImageStatusMap } from "./image-status-client";
vi.mock("./image-status-client", async (original) => ({
  ...(await original<typeof import("./image-status-client")>()),
  fetchAssetImageStatuses: vi.fn(),
}));
const session = vi.hoisted(() => ({ id: "alice" }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: session.id } }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let latest: UseAssetImageStatusesResult;
const pending: AssetImageStatusMap = { role: { status: "generating", updatedAt: 1 } };
const ready: AssetImageStatusMap = { role: { status: "ready", updatedAt: 2 } };
function Probe({ project }: { project: string }) {
  const value = useAssetImageStatuses(project);
  useLayoutEffect(() => {
    latest = value;
  });
  return null;
}
async function render(project = "a") {
  await act(async () => root.render(<Probe project={project} />));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchAssetImageStatuses).mockReset();
  session.id = "alice";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("retries a failed poll while work remains pending", async () => {
  vi.mocked(fetchAssetImageStatuses)
    .mockResolvedValueOnce(pending)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(ready);
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(latest.statuses).toEqual(ready);
  expect(fetchAssetImageStatuses).toHaveBeenCalledTimes(3);
});
it("retries an initial retrieval failure", async () => {
  vi.mocked(fetchAssetImageStatuses)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(ready);
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(latest.statuses).toEqual(ready);
});
it("clears previous project statuses while its replacement loads", async () => {
  vi.mocked(fetchAssetImageStatuses)
    .mockResolvedValueOnce(ready)
    .mockImplementation(() => new Promise(() => {}));
  await render();
  await render("b");
  expect(latest.statuses).toEqual({});
});
it("clears the previous account and rejects its retained refresh action", async () => {
  vi.mocked(fetchAssetImageStatuses)
    .mockResolvedValueOnce(ready)
    .mockImplementation(() => new Promise(() => {}));
  await render();
  const abandoned = latest.refetch;
  session.id = "bob";
  await render();
  const count = vi.mocked(fetchAssetImageStatuses).mock.calls.length;
  await act(async () => abandoned());
  expect(latest.statuses).toEqual({});
  expect(fetchAssetImageStatuses).toHaveBeenCalledTimes(count);
});
it("ignores delayed old results and stops polling after a terminal result", async () => {
  let finish!: (value: AssetImageStatusMap) => void;
  const old = new Promise<AssetImageStatusMap>((resolve) => {
    finish = resolve;
  });
  vi.mocked(fetchAssetImageStatuses).mockReturnValueOnce(old).mockResolvedValue(ready);
  await render();
  const oldSignal = vi.mocked(fetchAssetImageStatuses).mock.calls[0]![1]!;
  await render("b");
  expect(oldSignal.aborted).toBe(true);
  await act(async () => finish(pending));
  expect(latest.statuses).toEqual(ready);
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(fetchAssetImageStatuses).toHaveBeenCalledTimes(2);
});
it("clears retries on unmount", async () => {
  vi.mocked(fetchAssetImageStatuses).mockRejectedValue(new Error("offline"));
  await render();
  act(() => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(fetchAssetImageStatuses).toHaveBeenCalledTimes(1);
});
