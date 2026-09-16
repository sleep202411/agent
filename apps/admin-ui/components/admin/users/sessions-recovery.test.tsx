// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { SessionsPanel } from "./sessions-panel";
import type { AdminSessionRow } from "./types";
const confirmations = vi.hoisted(() => new Map<string, () => Promise<void>>());
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    description,
    onConfirm,
  }: {
    description: string;
    onConfirm: () => Promise<void>;
  }) => {
    confirmations.set(description, onConfirm);
    return <span>{description}</span>;
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fetchMock = vi.fn();
let root: Root | undefined;
let container: HTMLDivElement;
const row = (id: string): AdminSessionRow => ({
  id,
  userId: id,
  userEmail: `${id}@fixture.invalid`,
  userDisplayName: id,
  status: "active",
  ipAddress: null,
  userAgent: null,
  createdAt: "2026-01-01",
  lastSeenAt: "2026-01-01",
  expiresAt: "2027-01-01",
  revokedAt: null,
});
const response = (items = [row("fresh")], ok = true) => ({
  ok,
  status: ok ? 200 : 503,
  json: () =>
    Promise.resolve({ code: ok ? 200 : 503, msg: "Session service unavailable", data: { items } }),
});
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function render(scope = "one") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={scope}>
        <SessionsPanel
          currentUserId="me"
          currentSessionId="current"
          siteLabel="Test"
          databaseLabel="Local"
          initialData={{ items: [row("alpha"), row("beta")] }}
          initialError={null}
        />
      </AdminSessionBoundary>
    )
  );
}
function confirm(name: string) {
  return [...confirmations.entries()].find(([key]) => key.includes(`${name}（`))![1];
}
function refresh() {
  [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("刷新"))!.click();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  confirmations.clear();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("excludes competing revocations and propagates failed confirmations for retry", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render();
  const first = confirm("alpha");
  const second = confirm("beta");
  let result!: Promise<void>;
  await act(async () => {
    result = first();
    void result.catch(() => {});
    await second();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve(response([], false));
    await expect(result).rejects.toThrow("Session service unavailable");
  });
  expect(container.textContent).toContain("alpha");
  await act(async () => first());
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(container.textContent).toContain("fresh");
});
it("keeps accepted revocation distinct from failed refresh and retries only the read", async () => {
  fetchMock
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response([], false))
    .mockResolvedValue(response());
  await render();
  await act(async () => confirm("alpha")());
  expect(container.textContent).toContain("已吊销");
  expect(container.textContent).toContain("Session service unavailable");
  await act(async () => refresh());
  expect(fetchMock.mock.calls.map((call) => call[1].method)).toEqual([
    "POST",
    undefined,
    undefined,
  ]);
});
it("cancels a replaced session and suppresses delayed follow-up reads", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render();
  let result!: Promise<void>;
  await act(async () => {
    result = confirm("alpha")();
  });
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("two");
  expect(signal.aborted).toBe(true);
  await act(async () => {
    pending.resolve(response());
    await result;
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => confirm("beta")());
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
it("a revocation cancels an old read and delayed rows cannot overwrite its refresh", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render();
  const revoke = confirm("alpha");
  await act(async () => refresh());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => revoke());
  expect(signal.aborted).toBe(true);
  await act(async () => {
    pending.resolve(response([row("stale")]));
  });
  expect(container.textContent).toContain("fresh");
  expect(container.textContent).not.toContain("stale");
});
