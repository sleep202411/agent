// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "./admin-session-boundary";
import { AdminAuditPanel, type AdminAuditRow } from "./admin-audit-panel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const row = (id: string): AdminAuditRow => ({
  id,
  actor: null,
  actorSessionId: null,
  siteScope: "global",
  action: id,
  resourceType: "fixture",
  resourceId: null,
  outcome: "success",
  reason: null,
  ipAddress: null,
  userAgent: null,
  before: null,
  after: null,
  metadata: null,
  createdAt: "2026-01-01T00:00:00Z",
});
const data = (page = 1, id = "Loaded") => ({ items: [row(id)], total: 40, page, pageSize: 20 });
const response = (page = 1, id = "Loaded") => ({
  ok: true,
  json: () => Promise.resolve({ code: 200, data: data(page, id) }),
});
function deferred() {
  let resolve!: (r: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function render(session = "alice") {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={session}>
        <AdminAuditPanel databaseLabel="Fixture" initialData={data()} />
      </AdminSessionBoundary>
    )
  );
}
async function tick() {
  await act(async () => vi.advanceTimersByTimeAsync(250));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("cancels a search immediately during debounce and ignores old results", async () => {
  const old = deferred();
  fetchMock.mockReturnValueOnce(old.promise).mockResolvedValue(response(1, "Current"));
  await render();
  await tick();
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "new query"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(response(1, "Stale")));
  expect(container.textContent).not.toContain("Stale");
  await tick();
  expect(container.textContent).toContain("Current");
  expect(fetchMock.mock.calls[1][0]).toContain("q=new+query");
});
it("clears prior errors after a successful debounced search", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Audit unavailable")).mockResolvedValue(response());
  await render();
  await tick();
  expect(container.textContent).toContain("Audit unavailable");
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "changed"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await tick();
  expect(container.textContent).not.toContain("Audit unavailable");
});
it("cancels account reads and never publishes their audit entries", async () => {
  const old = deferred();
  fetchMock.mockReturnValue(old.promise);
  await render();
  await tick();
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("bob");
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(response(1, "Private old row")));
  expect(container.textContent).not.toContain("Private old row");
});
