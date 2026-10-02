import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/src/lib/api";
import { ProjectWorkspace } from "./project-workspace";

const state = vi.hoisted(() => ({
  projectError: null as Error | null,
  docError: null as Error | null,
  missing: false,
  fetching: false,
  retryProject: vi.fn(),
  retryDoc: vi.fn(),
}));
vi.mock("../../../_hooks/use-project", () => ({
  useProject: () => ({
    data: state.missing ? undefined : { id: "project" },
    error: state.projectError,
    isError: !!state.projectError,
    isFetching: state.fetching,
    refetch: state.retryProject,
  }),
}));
vi.mock("../../../_hooks/use-document", () => ({
  useFirstSectionCanvas: () => ({
    data: state.missing ? undefined : { id: "canvas" },
    error: state.docError,
    isError: !!state.docError,
    isFetching: state.fetching,
    refetch: state.retryDoc,
  }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "zh-HK",
  useTranslations: () => (key: string) => key,
}));
vi.mock("./canvas/storyboard-canvas", () => ({
  StoryboardCanvas: function Canvas() {
    const [draft, setDraft] = useState("");
    return (
      <input aria-label="Canvas draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
    );
  },
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(state, { projectError: null, docError: null, missing: false, fetching: false });
  state.retryProject.mockReset();
  state.retryDoc.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = () => act(() => root.render(<ProjectWorkspace projectId="project" />));
const retry = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "retry")!;
it.each(["projectError", "docError"] as const)(
  "retries %s without mislabeling it as a missing project",
  (key) => {
    state.missing = true;
    state[key] = new Error("Service temporarily unavailable");
    render();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Service temporarily unavailable"
    );
    expect(host.textContent).not.toContain("projectNotFound");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/zh-HK/fizzstudio");
    act(() => retry().click());
    expect(key === "projectError" ? state.retryProject : state.retryDoc).toHaveBeenCalledOnce();
    expect(key === "projectError" ? state.retryDoc : state.retryProject).not.toHaveBeenCalled();
    state.fetching = true;
    render();
    expect(retry().disabled).toBe(true);
    state[key] = null;
    state.missing = false;
    state.fetching = false;
    render();
    expect(host.querySelector("input")).not.toBeNull();
  }
);
it("keeps the mounted canvas on a temporary refresh failure", () => {
  render();
  const editor = host.querySelector("input");
  state.docError = new Error("Refresh interrupted");
  render();
  expect(host.querySelector("input")).toBe(editor);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Refresh interrupted");
  state.docError = null;
  render();
  expect(host.querySelector("input")).toBe(editor);
});
it.each([401, 403, 404, 410])("removes the cached canvas after HTTP %s", (status) => {
  render();
  state.projectError = new ApiRequestError(status, "Access unavailable", status);
  render();
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).toContain("projectNotFoundHint");
  act(() => retry().click());
  expect(state.retryProject).toHaveBeenCalledOnce();
  state.projectError = null;
  render();
  expect(host.querySelector("input")).not.toBeNull();
});
