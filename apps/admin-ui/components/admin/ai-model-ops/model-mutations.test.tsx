// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { AiModelOpsPanel } from "./ai-model-ops-panel";
import type { AdminAiModelOpsInitialData, AdminAiProviderAccount } from "@/lib/admin-ai-model-ops";
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
const provider = (id: string): AdminAiProviderAccount => ({
  id,
  provider: id,
  status: "active",
  rateLimitPolicy: { marker: id },
  quotaPolicy: {},
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  endpointCount: 0,
  bindingCount: 0,
});
const providers = { items: [provider("fal"), provider("openai")] };
const initial: AdminAiModelOpsInitialData = {
  overview: null,
  providers,
  endpoints: null,
  models: null,
  bindings: null,
  jobs: null,
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
async function render(session = "alice") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={session}>
        <AiModelOpsPanel
          view="providers"
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
function submit() {
  container
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("guards rapid policy saves and target changes and retains failed drafts", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render();
  await act(async () => click("编辑"));
  await act(async () => {
    submit();
    submit();
    click("编辑", 1);
    click("Close fixture");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("form")?.hasAttribute("inert")).toBe(true);
  await act(async () => pending.reject(new Error("Policy unavailable")));
  expect(container.querySelector('[role="dialog"]')!.textContent).toContain("Policy unavailable");
  expect(
    container.querySelector<HTMLTextAreaElement>('textarea[name="rateLimitPolicy"]')!.value
  ).toContain("fal");
  await act(async () => submit());
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
it("cancels old account mutations without starting their refresh", async () => {
  const old = deferred();
  fetchMock.mockReturnValue(old.promise);
  await render();
  await act(async () => click("编辑"));
  await act(async () => submit());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("bob");
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(response()));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it("reports accepted-write refresh failure without leaving a resubmittable form", async () => {
  const companion = deferred();
  fetchMock
    .mockResolvedValueOnce(response())
    .mockRejectedValueOnce(new Error("Catalog unavailable"))
    .mockReturnValueOnce(companion.promise);
  await render();
  await act(async () => click("编辑"));
  await act(async () => submit());
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain("Catalog unavailable");
  expect(fetchMock.mock.calls.every((call) => (call[1].signal as AbortSignal).aborted)).toBe(true);
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(response(url.endsWith("/providers") ? providers : { items: [] }))
  );
  await act(async () => click("刷新"));
  expect(fetchMock.mock.calls.slice(3).every((call) => !call[1].method)).toBe(true);
});
it("resets native policy defaults when switching provider drawers", async () => {
  await render();
  await act(async () => click("编辑"));
  expect(
    container.querySelector<HTMLTextAreaElement>('textarea[name="rateLimitPolicy"]')!.value
  ).toContain("fal");
  await act(async () => click("编辑", 1));
  expect(
    container.querySelector<HTMLTextAreaElement>('textarea[name="rateLimitPolicy"]')!.value
  ).toContain("openai");
});
