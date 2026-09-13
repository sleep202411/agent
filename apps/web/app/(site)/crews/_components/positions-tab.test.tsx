import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PositionsTab } from "./positions-tab";

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
vi.mock("@tanstack/react-query", () => ({ useInfiniteQuery: () => feed }));
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
});
it.each(["initial", "refresh", "next"])(
  "retains loaded openings and retries a %s failure",
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
    expect(container.querySelectorAll("article").length).toBe(kind === "initial" ? 0 : 1);
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
