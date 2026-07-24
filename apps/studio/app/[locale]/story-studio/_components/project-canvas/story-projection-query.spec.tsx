// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveStoryCanvasEditPolicy,
  resolveStoryCanvasProjectionSurface,
  resolveStoryProjectionReadiness,
  storyProjectionQueryOptions,
} from "./story-canvas-edit-policy";
import { useLastDefinedData } from "./use-last-defined-data";

interface HarnessProps {
  chapterId?: string;
  queryFn: () => Promise<string>;
}

function Harness({ chapterId = "chapter-1", queryFn }: HarnessProps) {
  const query = useQuery(
    storyProjectionQueryOptions({
      kind: "workbench",
      workspaceId: "workspace-1",
      projectId: "project-1",
      chapterId,
      queryFn,
    })
  );
  const projection = useLastDefinedData(query.data);
  const readiness = resolveStoryProjectionReadiness({
    hasWorkspace: true,
    workbenchFetchedAfterMount: query.isFetchedAfterMount,
    workbenchError: query.isError,
    layoutFetchedAfterMount: query.isFetchedAfterMount,
    layoutError: query.isError,
  });
  const surface = resolveStoryCanvasProjectionSurface(readiness, projection !== undefined);
  const editPolicy = resolveStoryCanvasEditPolicy({
    basePermissions: {
      canEditContent: true,
      canEditLayout: true,
      canManageProduction: true,
      canPreview: true,
      canPublish: true,
    },
    projectionReadiness: readiness,
    hasDraftConflict: false,
    hasLayoutConflict: false,
  });

  return (
    <span
      data-value={projection ?? "none"}
      data-readiness={readiness}
      data-surface={surface}
      data-writable={String(
        editPolicy.canEditContent && editPolicy.canEditLayout && editPolicy.canManageProduction
      )}
    />
  );
}

describe("Story projection query lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let fetchCount: number;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity } },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    fetchCount = 0;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  });

  it("loads directly on cold start and opens writes after the canonical read", async () => {
    const first = deferred<string>();
    await render({
      queryFn: () => {
        fetchCount += 1;
        return first.promise;
      },
    });

    expect(value()).toBe("none");
    expect(surface()).toBe("loading");
    expect(readiness()).toBe("loading");
    expect(writable()).toBe(false);

    await act(async () => {
      first.resolve("projection-v1");
      await flush();
    });
    expect(value()).toBe("projection-v1");
    expect(surface()).toBe("canvas");
    expect(readiness()).toBe("ready");
    expect(writable()).toBe(true);
    expect(fetchCount).toBe(1);
  });

  it("keeps the previous chapter mounted while the next chapter loads", async () => {
    await render({
      chapterId: "chapter-1",
      queryFn: async () => {
        fetchCount += 1;
        return "chapter-1-projection";
      },
    });
    await act(async () => flush());
    expect(value()).toBe("chapter-1-projection");
    expect(writable()).toBe(true);

    const secondChapter = deferred<string>();
    await render({
      chapterId: "chapter-2",
      queryFn: () => {
        fetchCount += 1;
        return secondChapter.promise;
      },
    });

    expect(value()).toBe("chapter-1-projection");
    expect(surface()).toBe("canvas");
    expect(readiness()).toBe("loading");
    expect(writable()).toBe(false);

    await act(async () => {
      secondChapter.resolve("chapter-2-projection");
      await flush();
    });
    expect(value()).toBe("chapter-2-projection");
    expect(readiness()).toBe("ready");
    expect(writable()).toBe(true);
  });

  it("keeps stale content visible but closes writes after a failed chapter read", async () => {
    await render({
      chapterId: "chapter-1",
      queryFn: async () => {
        fetchCount += 1;
        return "projection-v1";
      },
    });
    await act(async () => flush());

    await render({
      chapterId: "chapter-2",
      queryFn: async () => {
        fetchCount += 1;
        throw new Error("Fresh read failed");
      },
    });
    await act(async () => {
      await flush();
      await flush();
    });

    expect(value()).toBe("projection-v1");
    expect(surface()).toBe("canvas");
    expect(readiness()).toBe("unavailable");
    expect(writable()).toBe(false);
  });

  async function render(props: HarnessProps) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness {...props} />
        </QueryClientProvider>
      );
      await Promise.resolve();
    });
  }

  async function flush() {
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  }

  function attribute(name: string): string {
    return container.querySelector("span")?.getAttribute(name) ?? "missing";
  }

  function value(): string {
    return attribute("data-value");
  }

  function readiness(): string {
    return attribute("data-readiness");
  }

  function surface(): string {
    return attribute("data-surface");
  }

  function writable(): boolean {
    return attribute("data-writable") === "true";
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
