// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { StoryProjectChapterScope } from "./story-project-chapter-scope";

const query = vi.hoisted(() => ({
  pathname: "/story-studio/projects/project-1/canvas",
  options: null as null | { retry?: (failureCount: number, error: unknown) => boolean },
  refetch: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { retry?: (failureCount: number, error: unknown) => boolean }) => {
    query.options = options;
    return {
      data: undefined,
      error: new ApiRequestError("STORY_PROJECT_NOT_FOUND", "Story project not found.", 404),
      isError: true,
      refetch: query.refetch,
    };
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ signIn: vi.fn() }),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: React.ComponentProps<"a">) => <a href={String(href)}>{children}</a>,
  usePathname: () => query.pathname,
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/story-projects-api", () => ({
  getStoryWorkbench: vi.fn(),
}));

describe("StoryProjectChapterScope access failure", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    query.options = null;
    query.pathname = "/story-studio/projects/project-1/canvas";
    query.refetch.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders the expected access state without mounting project chrome", async () => {
    await act(async () => {
      root.render(
        <StoryProjectChapterScope projectId="project-1">
          <div data-testid="project-shell">Project shell</div>
        </StoryProjectChapterScope>
      );
    });

    expect(container.querySelector('[data-slot="story-project-load-state"]')).not.toBeNull();
    expect(container.textContent).toContain("unavailable.title");
    expect(container.querySelector('[data-testid="project-shell"]')).toBeNull();
  });

  it("installs the access-aware retry policy on the authorization read", async () => {
    await act(async () => {
      root.render(
        <StoryProjectChapterScope projectId="project-1">Project shell</StoryProjectChapterScope>
      );
    });

    const retry = query.options?.retry;
    expect(retry).toBeTypeOf("function");
    expect(retry?.(0, new ApiRequestError("HTTP_404", "missing", 404))).toBe(false);
    expect(retry?.(0, new ApiRequestError("HTTP_503", "offline", 503))).toBe(true);
  });

  it("keeps playtest inside the project chapter access gate", async () => {
    query.pathname = "/story-studio/projects/project-1/playtest";
    const render = () =>
      root.render(
        <StoryProjectChapterScope projectId="project-1">
          <div data-testid="playtest">Project playtest</div>
        </StoryProjectChapterScope>
      );
    await act(async () => render());
    expect(container.querySelector('[data-testid="playtest"]')).toBeNull();
    expect(query.options).not.toBeNull();
    expect(container.textContent).toContain("unavailable.title");
    query.pathname = "/story-studio/projects/project-1/canvas";
    await act(async () => render());
    expect(container.querySelector('[data-testid="playtest"]')).toBeNull();
    expect(container.textContent).toContain("unavailable.title");
  });
});
