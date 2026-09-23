import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
import { CrewApiError } from "../_hooks/api";
const query = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: false,
  isError: true,
  isFetching: false,
  error: new Error("Service unavailable"),
  refetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "crew" }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("../_hooks/use-crew", () => ({ useCrewDetail: () => query }));
vi.mock("./_components/crew-detail-new", () => ({
  CrewDetail: () => <input defaultValue="application draft" />,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  query.data = undefined;
  query.error = new Error("Service unavailable");
  query.isFetching = false;
  query.isError = true;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.clearAllMocks();
});
it("offers retry instead of claiming a transient failure is not found", () => {
  act(() => root.render(<Page />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Service unavailable");
  const retry = container.querySelector("button")!;
  expect(retry).not.toBeNull();
  act(() => retry.click());
  expect(query.refetch).toHaveBeenCalledOnce();
  query.isFetching = true;
  act(() => root.render(<Page />));
  expect(container.querySelector("button")?.disabled).toBe(true);
});
it("preserves the mounted detail during a transient refresh failure", () => {
  query.data = { id: "crew" };
  query.isError = false;
  act(() => root.render(<Page />));
  const input = container.querySelector("input")!;
  input.value = "unsent application";
  query.isError = true;
  act(() => root.render(<Page />));
  expect(container.querySelector("input")).toBe(input);
  expect(input.value).toBe("unsent application");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Service unavailable");
});
it.each([401, 403, 404])("removes cached detail after authoritative %s", (status) => {
  query.data = { id: "crew" };
  query.error = new CrewApiError(status, { message: "Unavailable" });
  act(() => root.render(<Page />));
  expect(container.querySelector("input")).toBeNull();
});
