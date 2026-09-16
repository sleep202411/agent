// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { AiModelOpsPanel } from "./ai-model-ops-panel";
import type {
  AdminAiJobListItem,
  AdminAiModelOpsInitialData,
  AdminAiModelOpsView,
} from "@/lib/admin-ai-model-ops";
vi.mock("@/components/ui/sheet", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Sheet: ({
      open,
      children,
      onOpenChange,
    }: {
      open: boolean;
      children: ReactNode;
      onOpenChange: (open: boolean) => void;
    }) =>
      open ? (
        <section role="dialog">
          <button onClick={() => onOpenChange(false)}>Close fixture</button>
          {children}
        </section>
      ) : null,
    SheetContent: Part,
    SheetHeader: Part,
    SheetFooter: Part,
    SheetTitle: Part,
    SheetDescription: Part,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const job = (id: string): AdminAiJobListItem => ({
  id,
  provider: "fal",
  modelId: "model",
  deployment: "global",
  providerJobId: null,
  status: "completed",
  stage: "done",
  userId: "123",
  prompt: `Prompt ${id}`,
  createdAt: "2026-01-01T00:00:00Z",
  completedAt: null,
  cost: null,
  metrics: null,
  error: null,
  routingSnapshot: null,
  canonicalModel: null,
  providerBinding: null,
  attempts: [],
  outputs: [],
  costLedger: [],
});
const initial: AdminAiModelOpsInitialData = {
  overview: null,
  providers: null,
  endpoints: null,
  models: null,
  bindings: null,
  jobs: { items: [job("one"), job("two")] },
  assets: null,
  error: null,
};
const response = (data: unknown = { items: [] }) => ({
  ok: true,
  json: () => Promise.resolve({ code: 200, data }),
});
function deferred() {
  let resolve!: (r: ReturnType<typeof response>) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(view: AdminAiModelOpsView = "jobs", session = "alice") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={session}>
        <AiModelOpsPanel
          view={view}
          siteLabel="Global"
          databaseLabel="Fixture"
          initialData={initial}
        />
      </AdminSessionBoundary>
    )
  );
}
function click(text: string, index = 0) {
  [...container.querySelectorAll("button")]
    .filter((b) => b.textContent?.trim() === text)
    [index]!.click();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("cancels unfinished overview companions after failure and supports retry", async () => {
  const old = deferred();
  fetchMock.mockRejectedValueOnce(new Error("Overview unavailable")).mockReturnValue(old.promise);
  await render("overview");
  await act(async () => click("刷新"));
  expect(fetchMock).toHaveBeenCalledTimes(7);
  expect(fetchMock.mock.calls.every((call) => (call[1].signal as AbortSignal).aborted)).toBe(true);
  expect(container.textContent).toContain("Overview unavailable");
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(response(url.endsWith("/overview") ? null : { items: [] }))
  );
  await act(async () => click("刷新"));
  expect(fetchMock).toHaveBeenCalledTimes(14);
});
it("cancels prior-view reads and ignores their late state", async () => {
  const old = deferred();
  fetchMock.mockReturnValue(old.promise);
  await render();
  await act(async () => click("刷新"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("providers");
  expect(signal.aborted).toBe(true);
  await act(async () => old.reject(new Error("Stale view")));
  expect(container.textContent).not.toContain("Stale view");
});
it("replaces job-detail reads and keeps current evidence", async () => {
  const old = deferred();
  fetchMock
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(response({ ...job("two"), traceEvents: [] }));
  await render();
  await act(async () => click("详情", 0));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => click("详情", 1));
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(response({ ...job("one"), traceEvents: [] })));
  expect(container.querySelector('[role="dialog"]')!.textContent).toContain("Prompt two");
  expect(container.querySelector('[role="dialog"]')!.textContent).not.toContain("Prompt one");
});
it("reopens failed details and cancels a closed job request", async () => {
  const next = deferred();
  fetchMock
    .mockRejectedValueOnce(new Error("Evidence unavailable"))
    .mockReturnValueOnce(next.promise);
  await render();
  await act(async () => click("详情"));
  expect(container.textContent).toContain("Evidence unavailable");
  await act(async () => click("Close fixture"));
  await act(async () => click("详情"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await act(async () => click("Close fixture"));
  expect(signal.aborted).toBe(true);
  await act(async () => next.resolve(response({ ...job("one"), traceEvents: [] })));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it("cancels account-scoped job reads", async () => {
  const old = deferred();
  fetchMock.mockReturnValue(old.promise);
  await render();
  await act(async () => click("详情"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("jobs", "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => old.reject(new Error("Old account error")));
  expect(container.textContent).not.toContain("Old account error");
});
