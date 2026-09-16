// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useModeDocument } from "./use-mode-document";
const ensure = vi.hoisted(() => vi.fn());
vi.mock("./projects-api", () => ({ ensureModeDocument: ensure }));
let root: Root;
let container: HTMLDivElement;
let pending: Array<{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }>;
function Harness({ project, type }: { project: string | null; type: string }) {
  const state = useModeDocument(project, type);
  return (
    <div data-status={state.status} data-error={state.error}>
      {state.documentId ?? "none"}
    </div>
  );
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
});
it.each([
  ["b", "brief"],
  ["a", "other"],
  [null, "brief"],
])("does not expose the old document after changing to %s/%s", async (project, type) => {
  await act(async () => root.render(<Harness project="a" type="brief" />));
  await act(async () => pending[0]?.resolve({ id: "doc-a" }));
  expect(container.textContent).toBe("doc-a");
  await act(async () => root.render(<Harness project={project} type={type!} />));
  expect(container.textContent).toBe("none");
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
  await act(async () => pending[2]?.resolve({ id: "doc-c" }));
  await act(async () => pending[1]?.resolve({ id: "doc-b" }));
  expect(container.textContent).toBe("doc-c");
});
