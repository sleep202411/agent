import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PositionsTab } from "./positions-tab";
import { CrewApiError } from "../_hooks/api";

const feed = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: false,
  isError: true,
  isFetching: false,
  isFetchNextPageError: false,
  error: new Error("Positions unavailable"),
  isFetchingNextPage: false,
  hasNextPage: true,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
vi.mock("./opening-details", () => ({
  OpeningDetails: ({ positionId }: { positionId: string }) => (
    <div data-testid="selected-opening">{positionId}</div>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: () => feed,
  useQuery: () => ({
    data: [
      { id: 13, name: "AI Producer" },
      { id: 14, name: "Editor" },
    ],
  }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/env", () => ({ env: { BANNER_BASE_URL: "https://example.com" } }));
vi.mock("../_hooks/use-position-label", () => ({
  useTranslatePositionValue: () => (value: string) => value,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  vi.clearAllMocks();
  feed.isError = true;
  vi.unstubAllGlobals();
});
it.each(["initial", "refresh", "next"])(
  "clears stale openings and retries a %s failure",
  (kind) => {
    feed.data =
      kind === "initial"
        ? undefined
        : {
            pages: [
              {
                total: 1,
                items: [
                  {
                    crew: { id: "crew", name: "Loaded Crew" },
                    position: {
                      id: "position",
                      positionType: "director",
                      status: "open",
                      targetCount: 2,
                      recruitedCount: 0,
                      employmentType: "full_time",
                      experienceLevel: "any",
                      workMode: "remote",
                      salary: { negotiable: true },
                    },
                  },
                ],
              },
            ],
          };
    feed.isFetchNextPageError = kind === "next";
    const container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(<PositionsTab />));
    expect(container.querySelectorAll("article").length).toBe(0);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Positions unavailable"
    );
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "retry"
    )!;
    act(() => retry.click());
    expect(feed.fetchNextPage).toHaveBeenCalledTimes(kind === "next" ? 1 : 0);
    expect(feed.refetch).toHaveBeenCalledTimes(kind === "next" ? 0 : 1);
  }
);

it("restarts recruitment discovery when its cursor is rejected", () => {
  feed.isFetchNextPageError = true;
  feed.error = new CrewApiError(400, {
    code: "CREW_POSITION_CURSOR_INVALID",
    message: "Restart the list",
  });
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<PositionsTab />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Restart the list");
  act(() =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "retry")!
      .click()
  );
  expect(feed.refetch).toHaveBeenCalledTimes(1);
  expect(feed.fetchNextPage).not.toHaveBeenCalled();
});

it("shows certification capabilities instead of the old rank filter", () => {
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<PositionsTab />));
  expect(container.textContent).toContain("AI Producer");
  expect(container.textContent).toContain("Editor");
  expect(container.textContent).not.toContain("filterSeniority");
});

it("selects details from the card body and keyboard title control", () => {
  feed.isError = false;
  feed.data = {
    pages: [
      {
        total: 2,
        items: ["one", "two"].map((id) => ({
          crew: { id: `crew-${id}`, name: `Crew ${id}` },
          position: {
            id,
            positionType: id,
            description: `Description ${id}`,
            employmentType: "full_time",
            experienceLevel: "any",
            workMode: "remote",
            salary: { negotiable: true },
          },
        })),
      },
    ],
  };
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<PositionsTab />));
  expect(container.querySelector('[data-testid="selected-opening"]')?.textContent).toBe("one");
  act(() =>
    container
      .querySelectorAll("article p")[1]!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }))
  );
  expect(container.querySelector('[data-testid="selected-opening"]')?.textContent).toBe("two");
  act(() => (container.querySelector("article h3 button") as HTMLButtonElement).click());
  expect(container.querySelector('[data-testid="selected-opening"]')?.textContent).toBe("one");
});
