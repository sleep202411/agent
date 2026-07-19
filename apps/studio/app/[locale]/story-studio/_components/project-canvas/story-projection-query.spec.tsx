// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveStoryAgentAuthoringPhase,
  resolveStoryCanvasEditPolicy,
  resolveStoryCanvasProjectionSurface,
  resolveStoryCanvasWriteAuthority,
  resolveStoryProjectionAuthority,
  storyProjectionQueryOptions,
} from "./story-canvas-edit-policy";
import { useLastDefinedData } from "./use-last-defined-data";

type AgentAuthorityState = "checking" | "ready" | "error";

interface HarnessProps {
  snapshotKey: string | null;
  agentAuthorityState: AgentAuthorityState;
  queryFn: () => Promise<string>;
}

/**
 * Integration regression for the projection query architecture: rotating the
 * authority snapshot key must refetch WITHOUT blanking the previously rendered
 * snapshot, while `resolveStoryProjectionAuthority` re-latches writes until the
 * fresh read lands. This exercises the exact pieces the Story canvas composes:
 * `storyProjectionQueryOptions` (placeholderData: keepPreviousData) feeding the
 * authority, surface, and edit-policy resolvers.
 */
function Harness({ snapshotKey, agentAuthorityState, queryFn }: HarnessProps) {
  const query = useQuery(
    storyProjectionQueryOptions({
      kind: "workbench",
      workspaceId: "workspace-1",
      projectId: "project-1",
      authoritySnapshotKey: snapshotKey,
      agentAuthorityState,
      queryFn,
    })
  );
  // Same composition as the Story canvas: `keepPreviousData` covers the
  // pending window of a rotated key; retention covers a failed fresh read.
  const projection = useLastDefinedData(query.data);
  const authority = resolveStoryProjectionAuthority({
    hasWorkspace: true,
    agentAuthorityState,
    workbenchFetchedAfterMount: query.isFetchedAfterMount,
    workbenchError: query.isError,
    layoutFetchedAfterMount: query.isFetchedAfterMount,
    layoutError: query.isError,
  });
  const surface = resolveStoryCanvasProjectionSurface(authority, projection !== undefined);
  const editPolicy = resolveStoryCanvasEditPolicy({
    basePermissions: {
      canEditContent: true,
      canEditLayout: true,
      canManageProduction: true,
      canPreview: true,
      canPublish: true,
    },
    hasDraftConflict: false,
    hasLayoutConflict: false,
    agentPhase: resolveStoryAgentAuthoringPhase({
      authorityState: resolveStoryCanvasWriteAuthority(authority),
      takeoverPending: false,
      applying: false,
      runStatus: null,
      resultDraftRevision: null,
      resultLayoutRevision: null,
      draftRevision: 0,
      layoutRevision: 0,
      hasConflict: false,
    }),
  });
  return (
    <span
      data-value={projection ?? "none"}
      data-authority={authority}
      data-surface={surface}
      data-writable={String(
        editPolicy.canEditContent && editPolicy.canEditLayout && editPolicy.canManageProduction
      )}
    />
  );
}

describe("Story projection queries under authority-key rotation", () => {
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

  it("shows the loading surface on a cold start and opens writes after the first read", async () => {
    const first = deferred<string>();
    await render({
      snapshotKey: "run-1:proposed:authority-0",
      agentAuthorityState: "ready",
      queryFn: () => {
        fetchCount += 1;
        return first.promise;
      },
    });

    expect(value()).toBe("none");
    expect(surface()).toBe("loading");
    expect(authority()).toBe("checking");
    expect(writable()).toBe(false);

    await act(async () => {
      first.resolve("projection-v1");
      await flush();
    });
    expect(value()).toBe("projection-v1");
    expect(surface()).toBe("canvas");
    expect(authority()).toBe("ready");
    expect(writable()).toBe(true);
    expect(fetchCount).toBe(1);
  });

  it("keeps the previous snapshot rendering across a key rotation while writes are latched", async () => {
    await render({
      snapshotKey: "run-1:proposed:authority-0",
      agentAuthorityState: "ready",
      queryFn: async () => {
        fetchCount += 1;
        return "projection-v1";
      },
    });
    await act(async () => flush());
    expect(value()).toBe("projection-v1");
    expect(writable()).toBe(true);

    // Run head transition rotates the authority key: the fresh read is in
    // flight, the previous data must keep rendering, and writes must close.
    const second = deferred<string>();
    await render({
      snapshotKey: "run-1:succeeded:authority-0",
      agentAuthorityState: "ready",
      queryFn: () => {
        fetchCount += 1;
        return second.promise;
      },
    });

    expect(value()).toBe("projection-v1");
    expect(surface()).toBe("canvas");
    expect(authority()).toBe("checking");
    expect(writable()).toBe(false);
    expect(fetchCount).toBe(2);

    await act(async () => {
      second.resolve("projection-v2");
      await flush();
    });
    expect(value()).toBe("projection-v2");
    expect(authority()).toBe("ready");
    expect(writable()).toBe(true);
  });

  it("keeps rendering through a lost-authority window (null key) without fetching it", async () => {
    await render({
      snapshotKey: "run-1:proposed:authority-0",
      agentAuthorityState: "ready",
      queryFn: async () => {
        fetchCount += 1;
        return "projection-v1";
      },
    });
    await act(async () => flush());
    expect(value()).toBe("projection-v1");

    // Realtime disconnect: the snapshot key passes through null and the
    // projection query is disabled until a post-disconnect canonical GET.
    await render({
      snapshotKey: null,
      agentAuthorityState: "checking",
      queryFn: async () => {
        fetchCount += 1;
        return "must-not-fetch";
      },
    });
    await act(async () => flush());

    expect(value()).toBe("projection-v1");
    expect(surface()).toBe("canvas");
    expect(authority()).toBe("checking");
    expect(writable()).toBe(false);
    expect(fetchCount).toBe(1);
  });

  it("fails closed on a failed fresh read while the previous snapshot stays mounted", async () => {
    await render({
      snapshotKey: "run-1:proposed:authority-0",
      agentAuthorityState: "ready",
      queryFn: async () => {
        fetchCount += 1;
        return "projection-v1";
      },
    });
    await act(async () => flush());

    await render({
      snapshotKey: "run-1:proposed:authority-1",
      agentAuthorityState: "ready",
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
    expect(authority()).toBe("unavailable");
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

  function authority(): string {
    return attribute("data-authority");
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
