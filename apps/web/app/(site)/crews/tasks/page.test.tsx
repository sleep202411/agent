// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import CrewTaskCenter from "./page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  key: [] as unknown[],
  next: vi.fn(),
  get: vi.fn(),
  empty: false,
  nextError: false,
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "viewer" } }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_components/task-unread-marker", () => ({ TaskUnreadMarker: () => null }));
vi.mock("../_hooks/api", () => ({ crewApi: { get: state.get } }));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({
    value,
    onChange,
    children,
  }: {
    value: string;
    onChange: (value: string) => void;
    children: ReactNode;
  }) => (
    // eslint-disable-next-line no-restricted-syntax -- Isolate the shared select boundary in this page test.
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {children}
    </select>
  ),
  NativeSelectOption: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    state.key = queryKey;
    return {
      data: {
        pages: [
          {
            items: state.empty
              ? []
              : [
                  {
                    id: "task-1",
                    title: "First review",
                    number: 1,
                    crew: { id: "crew-a", name: "Crew A" },
                    status: "open",
                    priority: "normal",
                    dueAt: null,
                  },
                  {
                    id: "task-2",
                    title: "Second review",
                    number: 2,
                    crew: { id: "crew-b", name: "Crew B" },
                    status: "in_progress",
                    priority: "high",
                    dueAt: null,
                  },
                ],
          },
        ],
      },
      isError: state.nextError,
      isFetchNextPageError: state.nextError,
      error: state.nextError ? new Error("Page unavailable") : null,
      hasNextPage: !state.empty,
      fetchNextPage: state.next,
    };
  },
}));
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  state.empty = false;
  state.nextError = false;
  vi.clearAllMocks();
});
function render() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<CrewTaskCenter />));
}
it("shows Crew context and localized task links across Crews, and requests the next page", () => {
  render();
  expect(document.body.textContent).toContain("Crew A");
  expect(document.body.textContent).toContain("Crew B");
  const taskLink = [...document.querySelectorAll("a")].find((link) =>
    link.textContent?.includes("Second review")
  )!;
  expect(taskLink.getAttribute("href")).toBe("/zh-CN/crews/crew-b/workspace?tab=tasks&task=task-2");
  act(() => document.querySelector("button")!.click());
  expect(state.next).toHaveBeenCalledOnce();
});
it("uses separate queries for assignment and completion filters", () => {
  render();
  const selects = document.querySelectorAll("select");
  act(() => {
    selects[0]!.value = "mine";
    selects[0]!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(state.key).toEqual(["crew", "task-center", "viewer", "mine", "active", ""]);
  act(() => {
    selects[1]!.value = "all";
    selects[1]!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(state.key).toEqual(["crew", "task-center", "viewer", "mine", "all", ""]);
});
it("shows an empty state with no load-more action", () => {
  state.empty = true;
  render();
  expect(document.body.textContent).toContain("empty");
  expect(document.querySelector("button")).toBeNull();
});

it("keeps existing tasks visible after a failed next page and retries that page", () => {
  state.nextError = true;
  render();
  expect(document.body.textContent).toContain("First review");
  expect(document.body.textContent).toContain("Second review");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Page unavailable");
  const retry = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "retry"
  )!;
  act(() => retry.click());
  expect(state.next).toHaveBeenCalledOnce();
});
