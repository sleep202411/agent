// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryWorkbench } from "@/lib/story-projects-api";
import type { InteractiveFilmPublicationStatus } from "@/lib/interactive-film-api";
import { useStoryProjectPublication } from "./use-story-project-publication";

const h = vi.hoisted(() => ({
  get: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  offline: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: "alice" }, isCurrentAccount: (id: string) => id === "alice" }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: h.error, success: h.success } }));
vi.mock("@/lib/interactive-film-api", () => ({
  getInteractiveFilmPublication: h.get,
  offlineInteractiveFilm: h.offline,
  prepareInteractiveFilmRelease: h.prepare,
  submitInteractiveFilmRelease: h.submit,
  interactiveFilmPublicationQueryKey: (id: string, user: string) => ["publication", id, user],
}));
vi.mock("../../_stores/story-project-ui-store", () => ({
  useStoryProjectUiStore: (select: (state: unknown) => unknown) =>
    select({ liveDraft: null, draftBarrier: null }),
}));

let host: HTMLDivElement,
  root: Root,
  client: QueryClient,
  hook: ReturnType<typeof useStoryProjectPublication>,
  workbench: StoryWorkbench,
  enabled: boolean | undefined;
function Harness() {
  const value = useStoryProjectPublication({ projectId: "project-one", workbench, enabled });
  useLayoutEffect(() => {
    hook = value;
  });
  return <span>{value.status}</span>;
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    )
  );
}
async function settle() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  enabled = undefined;
  h.get.mockResolvedValue(null);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  workbench = {
    project: {
      id: "project-one",
      projectVersion: 1,
      capabilities: ["story.read", "story.edit", "story.build", "story.release"],
    },
    draft: { revision: 3 },
    video: { snapshotHash: "a".repeat(64) },
  } as StoryWorkbench;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe("project publication operations", () => {
  it("pauses status requests and polling while closed, then resumes when opened", async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    enabled = false;
    h.get.mockResolvedValue({ gameId: "project-one", status: "draft", rejectReason: null });
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(h.get).not.toHaveBeenCalled();
    expect(hook.canRead).toBe(true);

    enabled = true;
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(hook.status).toBe("draft");
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(h.get).toHaveBeenCalledTimes(2);

    enabled = false;
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(h.get).toHaveBeenCalledTimes(2);
    expect(hook.status).toBe("draft");

    enabled = true;
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(h.get).toHaveBeenCalledTimes(3);
    expect(hook.status).toBe("draft");
  });

  it.each(["draft", "offline"] as InteractiveFilmPublicationStatus[])(
    "allows submission for %s",
    async (status) => {
      h.get.mockResolvedValue({ gameId: "project-one", status, rejectReason: null });
      await render();
      await settle();
      expect(hook.canSubmit).toBe(true);
      expect(hook.canOffline).toBe(false);
    }
  );

  it("retains submission success after the reviewing status locks another submission", async () => {
    const reviewing = {
      gameId: "project-one",
      status: "reviewing" as const,
      rejectReason: null,
    };
    h.prepare.mockResolvedValue({ gameId: "project-one" });
    h.submit.mockImplementation(async () => {
      h.get.mockResolvedValue(reviewing);
      return reviewing;
    });
    await render();
    await settle();
    await act(async () => hook.submission.confirm());
    await settle();
    expect(hook.status).toBe("reviewing");
    expect(hook.canSubmit).toBe(false);
    expect(hook.submission.state).toMatchObject({
      status: "succeeded",
      publication: reviewing,
    });
    await act(async () => hook.submission.retry());
    expect(h.prepare).toHaveBeenCalledOnce();
    expect(h.submit).toHaveBeenCalledOnce();
  });

  it.each(["reviewing", "published"] as InteractiveFilmPublicationStatus[])(
    "locks actual submission for %s and retains offline recovery",
    async (status) => {
      h.get.mockResolvedValue({ gameId: "project-one", status, rejectReason: null });
      await render();
      await settle();
      expect(hook.canSubmit).toBe(false);
      expect(hook.canOffline).toBe(true);
      expect(hook.disabledReason).toBe(
        status === "reviewing" ? "reviewingLocked" : "publishedUpdateLocked"
      );
    }
  );

  it("retains a status request failure separately from a review rejection", async () => {
    h.get.mockRejectedValue(Error("Java is unavailable."));
    await render();
    await settle();
    expect(hook.publicationQuery.isError).toBe(true);
    expect(hook.publication?.rejectReason).toBeUndefined();
    expect(hook.canSubmit).toBe(false);
    expect(hook.statusErrorKind).toBe("service");
    expect(hook.disabledReason).toBe("statusError.service.guidance Java is unavailable.");
  });

  it("allows editors to read project publication while keeping release actions disabled", async () => {
    workbench.project.capabilities = ["story.read", "story.edit", "story.build"];
    h.get.mockResolvedValue({ gameId: "project-one", status: "published", rejectReason: null });
    await render();
    await settle();
    expect(h.get).toHaveBeenCalled();
    expect(hook.canRead).toBe(true);
    expect(hook.status).toBe("published");
    expect(hook.canSubmit).toBe(false);
    expect(hook.canOffline).toBe(false);
    expect(hook.disabledReason).toBe("errors.permissionDenied");
    await act(async () => hook.submission.confirm());
    await act(async () => hook.offlineMutation.mutate());
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.offline).not.toHaveBeenCalled();
  });

  it("does not request publication when project read permission is absent", async () => {
    workbench.project.capabilities = [];
    await render();
    await settle();
    expect(h.get).not.toHaveBeenCalled();
    expect(hook.canSubmit).toBe(false);
    expect(hook.disabledReason).toBe("errors.permissionDenied");
  });

  it.each([
    [401, "UNAUTHORIZED", "auth"],
    [403, "STORY_PERMISSION_DENIED", "permission"],
    [503, "STORY_PUBLICATION_SERVICE_UNAVAILABLE", "service"],
    [403, "STORY_PUBLICATION_SERVICE_AUTH", "service"],
  ])("classifies status failure %s/%s as %s", async (status, code, kind) => {
    h.get.mockRejectedValue(Object.assign(Error("Specific upstream failure"), { status, code }));
    await render();
    await settle();
    expect(hook.statusErrorKind).toBe(kind);
    expect(hook.statusErrorReason).toBe(`statusError.${kind}.guidance Specific upstream failure`);
    expect(hook.canSubmit).toBe(false);
    expect(hook.canOffline).toBe(false);
  });

  it("hides cached status after project read permission is revoked", async () => {
    h.get.mockResolvedValue({ gameId: "project-one", status: "published", rejectReason: null });
    await render();
    await settle();
    expect(hook.status).toBe("published");
    workbench = { ...workbench, project: { ...workbench.project, capabilities: [] } };
    await render();
    expect(hook.canRead).toBe(false);
    expect(hook.publication).toBeNull();
    expect(hook.canOffline).toBe(false);
  });

  it("blocks offline writes after a cached publication status refresh fails", async () => {
    h.get.mockResolvedValue({ gameId: "project-one", status: "published", rejectReason: null });
    await render();
    await settle();
    h.get.mockRejectedValue(Object.assign(Error("Service unavailable"), { status: 503 }));
    await act(async () => hook.publicationQuery.refetch());
    await settle();
    expect(hook.status).toBe("published");
    expect(hook.canOffline).toBe(false);
    await act(async () => hook.offlineMutation.mutate());
    expect(h.offline).not.toHaveBeenCalled();
  });

  it.each(["permission", "status"] as const)(
    "closes an idle offline confirmation when %s eligibility is lost",
    async (change) => {
      h.get.mockResolvedValue({ gameId: "project-one", status: "published", rejectReason: null });
      await render();
      await settle();
      await act(async () => hook.openOffline());
      expect(hook.offlineIntent).toBe(true);
      if (change === "permission") {
        workbench = {
          ...workbench,
          project: {
            ...workbench.project,
            capabilities: ["story.read", "story.edit", "story.build"],
          },
        };
        await render();
      } else {
        h.get.mockRejectedValue(Object.assign(Error("Service unavailable"), { status: 503 }));
        await act(async () => hook.publicationQuery.refetch());
        await settle();
      }
      expect(hook.canOffline).toBe(false);
      expect(hook.offlineIntent).toBe(false);
      await act(async () => hook.offlineMutation.mutate());
      expect(h.offline).not.toHaveBeenCalled();
    }
  );

  it("keeps the offline confirmation open after a request fails, showing the upstream message", async () => {
    h.get.mockResolvedValue({ gameId: "project-one", status: "published", rejectReason: null });
    h.offline.mockRejectedValue(Error("Cannot take this version offline."));
    await render();
    await settle();
    await act(async () => hook.openOffline());
    await act(async () => hook.offlineMutation.mutate());
    await settle();
    expect(hook.offlineIntent).toBe(true);
    expect(hook.status).toBe("published");
    expect(h.error).toHaveBeenCalledWith("Cannot take this version offline.");
  });

  it("submits only one offline request when confirmation is clicked twice", async () => {
    h.get.mockResolvedValue({ gameId: "project-one", status: "published", rejectReason: null });
    let resolve!: (value: unknown) => void;
    h.offline.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    await render();
    await settle();
    await act(async () => {
      hook.offlineMutation.mutate();
      hook.offlineMutation.mutate();
    });
    await settle();
    expect(h.offline).toHaveBeenCalledOnce();
    expect(hook.offlineMutation.isPending).toBe(true);
    h.get.mockResolvedValue({ gameId: "project-one", status: "offline", rejectReason: null });
    await act(async () =>
      resolve({ gameId: "project-one", status: "offline", rejectReason: null })
    );
    await settle();
    expect(hook.status).toBe("offline");
  });

  it("refreshes cached draft status on confirmation and blocks a work already under review", async () => {
    h.get
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ gameId: "project-one", status: "reviewing", rejectReason: null });
    await render();
    await settle();
    expect(hook.canSubmit).toBe(true);
    await act(async () => hook.submission.confirm());
    await settle();
    expect(hook.status).toBe("reviewing");
    expect(hook.canSubmit).toBe(false);
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("reconciles an offline POST whose final GET failed instead of offering another offline request", async () => {
    h.get.mockResolvedValue({ gameId: "project-one", status: "published", rejectReason: null });
    h.offline.mockRejectedValueOnce(Error("Final status GET failed."));
    await render();
    await settle();
    await act(async () => hook.openOffline());
    h.get.mockResolvedValue({ gameId: "project-one", status: "offline", rejectReason: null });
    await act(async () => hook.offlineMutation.mutate());
    await settle();
    expect(hook.status).toBe("offline");
    expect(hook.offlineIntent).toBe(false);
    expect(hook.canOffline).toBe(false);
    expect(h.error).not.toHaveBeenCalled();
    expect(h.success).toHaveBeenCalledOnce();
    await act(async () => hook.offlineMutation.mutate());
    expect(h.offline).toHaveBeenCalledOnce();
  });
});
