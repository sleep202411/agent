import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { SectionCanvasBoundary } from "./project-section-boundary";
const state = vi.hoisted(() => ({
  status: "ready",
  error: null as Error | null,
  missing: false,
  refresh: vi.fn(),
  select: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("./canvas-connection-context", () => ({
  CanvasConnectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./project-sections-context", () => ({
  useProjectSections: () => ({
    activeSection: state.missing ? null : { id: "one", canvasDocumentId: "canvas" },
    sections: [{ id: "one", title: "Opening scene" }],
    status: state.status,
    error: state.error,
    refresh: state.refresh,
    selectSection: state.select,
  }),
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(state, { status: "ready", error: null, missing: false });
  state.refresh.mockReset().mockResolvedValue(undefined);
  state.select.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = () =>
  act(() =>
    root.render(
      <SectionCanvasBoundary projectId="project" canEdit>
        <input aria-label="Canvas draft" defaultValue="Private scene" />
      </SectionCanvasBoundary>
    )
  );
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
it("keeps the canvas mounted during a temporary chapter refresh failure", () => {
  render();
  const canvas = host.querySelector("input");
  state.status = "error";
  state.error = new Error("Read unavailable");
  render();
  expect(host.querySelector("input")).toBe(canvas);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Read unavailable");
  state.status = "ready";
  state.error = null;
  render();
  expect(host.querySelector("input")).toBe(canvas);
});
it("retries an initial failure with a pending state and a projects return", async () => {
  state.missing = true;
  state.status = "error";
  state.error = new Error("Read unavailable");
  let resolve!: () => void;
  state.refresh.mockReturnValue(
    new Promise<void>((r) => {
      resolve = r;
    })
  );
  render();
  await act(async () => button("retry").click());
  expect(button("retry").disabled).toBe(true);
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/projects");
  await act(async () => resolve());
  expect(button("retry").disabled).toBe(false);
  expect(state.refresh).toHaveBeenCalledOnce();
});
it("lets an invalid chapter link select an available chapter", () => {
  state.missing = true;
  state.status = "error";
  state.error = new Error("");
  render();
  expect(host.textContent).toContain("invalid");
  act(() => button("Opening scene").click());
  expect(state.select).toHaveBeenCalledWith("one");
});
it.each([401, 403, 404, 410])(
  "removes cached canvas and chapter choices after HTTP %s",
  (status) => {
    render();
    state.status = "error";
    state.error = new ApiRequestError(status, "No access", status);
    render();
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).not.toContain("Opening scene");
    expect(button("retry")).toBeDefined();
    expect(host.querySelector("a")).not.toBeNull();
  }
);
