// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useModeDocument } from "./use-mode-document";
const ensure = vi.hoisted(() => vi.fn());
const account = vi.hoisted(() => ({ id: "alice" }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: account.id }, loading: false }),
}));
let client: QueryClient;
function Harness(props: { project: string | null; type: string }) {
  return (
    <QueryClientProvider client={client}>
      <Reader {...props} />
    </QueryClientProvider>
  );
}
vi.mock("./projects-api", () => ({ ensureModeDocument: ensure }));
let root: Root;
let container: HTMLDivElement;
let pending: Array<{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }>;
function Reader({ project, type }: { project: string | null; type: string }) {
  const state = useModeDocument(project, type);
  return (
    <div data-status={state.status} data-error={state.error}>
      <span>{state.documentId ?? "none"}</span>
      <button disabled={state.retrying} onClick={state.retry}>
        Retry
      </button>
    </div>
  );
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  account.id = "alice";
  pending = [];
  ensure.mockReset();
  ensure.mockImplementation(
    () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
  );
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
});
it.each([
  ["b", "brief"],
  ["a", "other"],
  [null, "brief"],
])("does not expose the old document after changing to %s/%s", async (project, type) => {
  await act(async () => root.render(<Harness project="a" type="brief" />));
  await act(async () => {
    pending[0]?.resolve({ id: "doc-a" });
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(container.querySelector("span")?.textContent).toBe("doc-a");
  await act(async () => root.render(<Harness project={project} type={type!} />));
  expect(container.querySelector("span")?.textContent).toBe("none");
  expect(container.firstElementChild?.getAttribute("data-status")).toBe("loading");
});
it("clears obsolete failure feedback and cancels the abandoned lookup", async () => {
  await act(async () => root.render(<Harness project="a" type="brief" />));
  await act(async () => pending[0]?.reject(new Error("old failure")));
  await act(async () => root.render(<Harness project="b" type="brief" />));
  expect(container.firstElementChild?.getAttribute("data-error")).toBe(null);
  const signal = ensure.mock.calls[1]?.[2] as AbortSignal;
  await act(async () => root.render(<Harness project="c" type="brief" />));
  expect(signal.aborted).toBe(true);
  await act(async () => {
    pending[2]?.resolve({ id: "doc-c" });
    await new Promise((r) => setTimeout(r, 5));
  });
  await act(async () => pending[1]?.resolve({ id: "doc-b" }));
  expect(container.querySelector("span")?.textContent).toBe("doc-c");
});

it("retries a failed lookup and recovers its document", async () => {
  await act(async () => root.render(<Harness project="a" type="brief" />));
  await act(async () => {
    pending[0]?.reject(new Error("Lookup unavailable"));
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(container.firstElementChild?.getAttribute("data-error")).toBe("Lookup unavailable");
  await act(async () => {
    container.querySelector("button")!.click();
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(ensure).toHaveBeenCalledTimes(2);
  expect(container.querySelector("button")!.disabled).toBe(true);
  await act(async () => {
    pending[1]?.resolve({ id: "recovered" });
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(container.querySelector("span")?.textContent).toBe("recovered");
});
it("does not reuse another account's document", async () => {
  await act(async () => root.render(<Harness project="a" type="brief" />));
  await act(async () => {
    pending[0]?.resolve({ id: "alice-doc" });
    await new Promise((r) => setTimeout(r, 5));
  });
  account.id = "bob";
  await act(async () => root.render(<Harness project="a" type="brief" />));
  expect(container.querySelector("span")?.textContent).toBe("none");
  expect(ensure).toHaveBeenCalledTimes(2);
});

it("retains the resolved document through a temporary background failure", async () => {
  await act(async () => root.render(<Harness project="a" type="brief" />));
  await act(async () => {
    pending[0]?.resolve({ id: "brief" });
    await new Promise((r) => setTimeout(r, 5));
  });
  await act(async () => {
    void client.invalidateQueries({ queryKey: ["project-mode-document"] });
  });
  await act(async () => {
    pending[1]?.reject(new Error("Refresh unavailable"));
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(container.querySelector("span")?.textContent).toBe("brief");
  expect(container.firstElementChild?.getAttribute("data-status")).toBe("ready");
  expect(container.firstElementChild?.getAttribute("data-error")).toBe("Refresh unavailable");
});
