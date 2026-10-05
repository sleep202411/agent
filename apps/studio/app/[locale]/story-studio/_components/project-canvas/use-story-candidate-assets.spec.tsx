// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addStoryCandidateAsset,
  getStoryCandidateAssets,
  removeStoryCandidateAsset,
  type StoryCandidateAsset,
} from "@/lib/story-projects-api";
import {
  useStoryCandidateAssets,
  storyCandidateAssetsQueryKey,
  type StoryCandidateAssetsController,
} from "./use-story-candidate-assets";

const account = vi.hoisted(() => ({ id: "alice" }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: account.id ? { id: account.id } : null,
    isCurrentAccount: (id: string) => account.id === id,
  }),
}));
const notifications = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "actionError" ? "The candidate asset could not be updated." : key,
}));

vi.mock("sonner", () => ({
  toast: notifications,
}));

vi.mock("@/lib/story-projects-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/story-projects-api")>();
  return {
    ...actual,
    addStoryCandidateAsset: vi.fn(),
    getStoryCandidateAssets: vi.fn(),
    removeStoryCandidateAsset: vi.fn(),
  };
});

const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const ASSET_ID = "00000000-0000-4000-8000-000000000003";

describe("useStoryCandidateAssets", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let controller: StoryCandidateAssetsController | null;
  let enabled: boolean | undefined;

  let projectId = PROJECT_ID;
  let canEdit = true;

  function Harness() {
    controller = useStoryCandidateAssets({
      projectId,
      canEdit,
      enabled,
    });
    return <span data-loading={String(controller.loading)} />;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    controller = null;
    projectId = PROJECT_ID;
    canEdit = true;
    account.id = "alice";
    enabled = undefined;
    notifications.error.mockReset();
    vi.mocked(getStoryCandidateAssets).mockReset().mockResolvedValue([]);
    vi.mocked(addStoryCandidateAsset).mockReset().mockResolvedValue(candidateAsset());
    vi.mocked(removeStoryCandidateAsset).mockReset().mockResolvedValue({ mediaAssetId: ASSET_ID });
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.useRealTimers();
  });

  it("pauses automatic reads while closed and refreshes retained assets when reopened", async () => {
    vi.useFakeTimers();
    enabled = false;
    vi.mocked(getStoryCandidateAssets).mockResolvedValue([candidateAsset()]);
    await renderHarness();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(getStoryCandidateAssets).not.toHaveBeenCalled();
    expect(current().loading).toBe(false);

    enabled = true;
    await renderHarness();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(getStoryCandidateAssets).toHaveBeenCalledTimes(1);
    expect(current().items.map((item) => item.asset.id)).toEqual([ASSET_ID]);

    enabled = false;
    await renderHarness();
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: storyCandidateAssetsQueryKey(PROJECT_ID, "alice"),
      });
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getStoryCandidateAssets).toHaveBeenCalledTimes(1);
    expect(current().items.map((item) => item.asset.id)).toEqual([ASSET_ID]);

    enabled = true;
    await renderHarness();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(getStoryCandidateAssets).toHaveBeenCalledTimes(2);
    expect(current().items.map((item) => item.asset.id)).toEqual([ASSET_ID]);
  });

  it("coalesces rapid duplicate additions before React can render pending state", async () => {
    const addition = deferred<StoryCandidateAsset>();
    vi.mocked(addStoryCandidateAsset).mockReturnValue(addition.promise);
    await mountHarness();

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = current().toggle(ASSET_ID);
      second = current().toggle(ASSET_ID);
    });

    expect(addStoryCandidateAsset).toHaveBeenCalledTimes(1);
    expect(current().pendingIds.has(ASSET_ID)).toBe(true);

    addition.resolve(candidateAsset());
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(current().items.map((candidate) => candidate.asset.id)).toEqual([ASSET_ID]);
    expect(current().pendingIds.has(ASSET_ID)).toBe(false);
  });

  it("surfaces an actionable localized fallback when an update fails", async () => {
    vi.mocked(addStoryCandidateAsset).mockRejectedValue(new Error(""));
    await mountHarness();

    await act(async () => {
      await current().toggle(ASSET_ID);
    });

    expect(current().failed).toBe(false);
    expect(current().error).toBeNull();
    expect(notifications.error).toHaveBeenCalledWith("The candidate asset could not be updated.");
  });

  it("preserves the upstream candidate-list error for the drawer and clip inspector", async () => {
    vi.mocked(getStoryCandidateAssets).mockRejectedValue(new Error("Media index unavailable"));

    await mountHarness();

    expect(current().failed).toBe(true);
    expect(current().error).toBe("Media index unavailable");
    expect(current().items).toEqual([]);
  });

  it("does not expose the former account's cached candidate list", async () => {
    vi.mocked(getStoryCandidateAssets)
      .mockResolvedValueOnce([candidateAsset()])
      .mockResolvedValueOnce([]);
    await mountHarness();
    expect(current().items).toHaveLength(1);
    account.id = "bob";
    await mountHarness();
    expect(current().items).toEqual([]);
    expect(getStoryCandidateAssets).toHaveBeenCalledTimes(2);
  });

  it("retires an old project addition without blocking the same asset in the new project", async () => {
    const old = deferred<StoryCandidateAsset>();
    vi.mocked(addStoryCandidateAsset)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(candidateAsset());
    await mountHarness();
    let pending!: Promise<void>;
    act(() => {
      pending = current().toggle(ASSET_ID);
    });
    projectId = "new-project";
    await mountHarness();
    await act(async () => {
      await current().toggle(ASSET_ID);
    });
    expect(addStoryCandidateAsset).toHaveBeenCalledTimes(2);
    old.resolve(candidateAsset());
    await act(async () => {
      await pending;
    });
    expect(current().items).toHaveLength(1);
  });

  it("does not issue mutations from callbacks retained by the former account", async () => {
    await mountHarness();
    const former = current();
    account.id = "bob";
    await mountHarness();
    await act(async () => {
      await former.toggle(ASSET_ID);
      await former.remove(ASSET_ID);
    });
    expect(addStoryCandidateAsset).not.toHaveBeenCalled();
    expect(removeStoryCandidateAsset).not.toHaveBeenCalled();
  });

  it.each(["toggle", "remove"] as const)(
    "aborts pending %s and ignores its late result after account departure",
    async (operation) => {
      const late = deferred<StoryCandidateAsset>();
      const removal = deferred<{ mediaAssetId: string }>();
      vi.mocked(addStoryCandidateAsset).mockReturnValue(late.promise);
      vi.mocked(removeStoryCandidateAsset).mockReturnValue(removal.promise);
      await mountHarness();
      let pending!: Promise<void>;
      act(() => {
        pending = current()[operation](ASSET_ID);
      });
      const signal =
        operation === "toggle"
          ? vi.mocked(addStoryCandidateAsset).mock.calls[0]![2]
          : vi.mocked(removeStoryCandidateAsset).mock.calls[0]![2];
      expect(signal?.aborted).toBe(false);
      account.id = "bob";
      await mountHarness();
      expect(signal?.aborted).toBe(true);
      queryClient.removeQueries({ queryKey: storyCandidateAssetsQueryKey(PROJECT_ID, "alice") });
      late.resolve(candidateAsset());
      removal.resolve({ mediaAssetId: ASSET_ID });
      await act(async () => {
        await pending;
      });
      expect(
        queryClient.getQueryData(storyCandidateAssetsQueryKey(PROJECT_ID, "alice"))
      ).toBeUndefined();
      expect(current().items).toEqual([]);
      expect(current().pendingIds.size).toBe(0);
      expect(notifications.error).not.toHaveBeenCalled();
    }
  );

  it("does not load or mutate signed-out candidates, including manual refresh", async () => {
    account.id = "";
    await mountHarness();
    await act(async () => {
      await current().refresh();
      await current().toggle(ASSET_ID);
    });
    expect(getStoryCandidateAssets).not.toHaveBeenCalled();
    expect(addStoryCandidateAsset).not.toHaveBeenCalled();
    expect(current().canEdit).toBe(false);
  });

  it("retires pending edits when edit access is revoked and keeps reads available", async () => {
    const late = deferred<StoryCandidateAsset>();
    vi.mocked(addStoryCandidateAsset).mockReturnValue(late.promise);
    await mountHarness();
    const previous = current();
    let pending!: Promise<void>;
    act(() => {
      pending = previous.toggle(ASSET_ID);
    });
    canEdit = false;
    await mountHarness();
    expect(vi.mocked(addStoryCandidateAsset).mock.calls[0]![2]?.aborted).toBe(true);
    late.reject(new Error("retired error"));
    await act(async () => {
      await pending;
      await previous.toggle(ASSET_ID);
    });
    expect(addStoryCandidateAsset).toHaveBeenCalledOnce();
    expect(current().pendingIds.size).toBe(0);
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it("allows a failed removal to be retried without losing the candidate", async () => {
    vi.mocked(getStoryCandidateAssets).mockResolvedValue([candidateAsset()]);
    vi.mocked(removeStoryCandidateAsset)
      .mockRejectedValueOnce(new Error("Storage busy"))
      .mockResolvedValueOnce({ mediaAssetId: ASSET_ID });
    await mountHarness();
    await act(async () => {
      await current().remove(ASSET_ID);
    });
    expect(current().items).toHaveLength(1);
    expect(current().pendingIds.size).toBe(0);
    expect(notifications.error).toHaveBeenCalledWith("Storage busy");
    await act(async () => {
      await current().remove(ASSET_ID);
    });
    expect(current().items).toEqual([]);
  });

  async function mountHarness() {
    await renderHarness();
    await waitFor(() => !current().loading);
  }

  async function renderHarness() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>
      );
    });
  }

  function current(): StoryCandidateAssetsController {
    if (!controller) throw new Error("Candidate controller is unavailable.");
    return controller;
  }
});

function candidateAsset(): StoryCandidateAsset {
  return {
    asset: {
      id: ASSET_ID,
      kind: "image",
      status: "ready",
      moderationStatus: "approved",
      contentType: "image/png",
      width: 1024,
      height: 1024,
      durationSeconds: null,
      checksumSha256: "checksum",
      previewUrl: "https://example.test/image.png",
    },
    videoVariant: null,
    addedByUserId: "user-1",
    addedAt: "2026-07-23T12:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for condition.");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
