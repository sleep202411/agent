// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  MediaAssetSummary,
  StoryCandidateAsset,
  StoryWorkbench,
} from "@/lib/story-projects-api";
import { StoryPublicationDetailsDialog } from "./story-publication-details-dialog";

const PROJECT_ID = "019f60f4-b101-70d4-8000-000000000002";
const CHAPTER_ID = "019f60f4-b101-70d4-8000-000000000003";
const COVER_ID = "019f60f4-b101-70d4-8000-000000000004";
const SHOT_ID = "019f60f4-b101-70d4-8000-000000000005";
const h = vi.hoisted(() => ({
  user: { id: "alice" } as { id: string } | null,
  workbench: null as StoryWorkbench | null,
  items: [] as StoryCandidateAsset[],
  draftBarrier: null as ReturnType<typeof vi.fn> | null,
  loading: false,
  loadError: null as unknown,
  onOpenChange: vi.fn(),
  retry: vi.fn(),
  patch: vi.fn(),
  getWorkbench: vi.fn(),
  getPublication: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  offline: vi.fn(),
  push: vi.fn(),
  signIn: vi.fn(),
  refresh: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, values?: { index?: number }) =>
    values?.index ? `${key} ${values.index}` : key,
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({
    user: h.user,
    loading: false,
    signIn: h.signIn,
    isCurrentAccount: (id: string) => id === h.user?.id,
  }),
}));
vi.mock("@/app/_components/region-provider", () => ({ useSiteRegion: () => "global" }));
vi.mock("sonner", () => ({ toast: { error: h.error, success: h.success } }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- Expose image sources for media assertions.
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/lib/media-upload", () => ({ uploadFileViaSignedUrl: vi.fn() }));
vi.mock("@/lib/story-projects-api", () => ({
  updateStoryProject: h.patch,
  getStoryWorkbench: h.getWorkbench,
  addStoryCandidateAsset: vi.fn(),
  storyApiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  storyApiErrorBody: () => null,
  storyApiErrorCode: () => null,
}));
vi.mock("@/lib/interactive-film-api", () => ({
  getInteractiveFilmPublication: h.getPublication,
  prepareInteractiveFilmRelease: h.prepare,
  submitInteractiveFilmRelease: h.submit,
  offlineInteractiveFilm: h.offline,
  interactiveFilmPublicationQueryKey: (id: string, userId: string) => [
    "story-studio",
    "interactive-film-publication",
    id,
    userId,
  ],
}));
vi.mock("../_stores/story-project-ui-store", () => ({
  useStoryProjectUiStore: (select: (state: unknown) => unknown) =>
    select({ liveDraft: null, draftBarrier: h.draftBarrier }),
}));
vi.mock("../_lib/use-story-chapter-workbench", () => ({
  storyChapterWorkbenchQueryKey: (
    project: string,
    chapter: string | null,
    user?: string | number | null
  ) => [
    "story-studio",
    "chapter-workbench",
    project,
    chapter,
    ...(user === undefined ? [] : [user]),
  ],
}));
vi.mock("./project-canvas/use-story-candidate-assets", () => ({
  useStoryCandidateAssets: () => ({
    items: h.items,
    loading: false,
    failed: false,
    error: null,
    refresh: h.refresh,
    candidateIds: new Set(),
    pendingIds: new Set(),
    canEdit: true,
    toggle: vi.fn(),
    remove: vi.fn(),
  }),
}));
vi.mock("./project-canvas/story-candidate-asset-picker-dialog", () => ({
  StoryCandidateAssetPickerDialog: () => null,
}));

let host: HTMLDivElement, root: Root, client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  h.user = { id: "alice" };
  h.draftBarrier = null;
  h.loading = false;
  h.loadError = null;
  const cover = asset(COVER_ID);
  h.workbench = {
    project: {
      id: PROJECT_ID,
      title: "Interactive Film",
      projectVersion: 3,
      capabilities: ["story.read", "story.edit", "story.build", "story.release"],
      cover,
      storeListing: {
        description: "Find your story",
        developer: "Crew",
        tags: [],
        trailerAssetId: null,
        screenshotAssetIds: [],
      },
    },
    chapter: { id: CHAPTER_ID },
    chapters: [{ id: CHAPTER_ID, title: "Opening", entryNodeId: "scene.entry", nodeCount: 1 }],
    draft: { revision: 7 },
    video: { snapshotHash: "a".repeat(64) },
  } as unknown as StoryWorkbench;
  h.items = [{ asset: cover, videoVariant: null, addedAt: "", addedByUserId: "alice" }];
  h.getPublication.mockResolvedValue(null);
  h.prepare.mockResolvedValue({ gameId: PROJECT_ID });
  h.submit.mockResolvedValue({ gameId: PROJECT_ID, status: "reviewing", rejectReason: null });
  h.getWorkbench.mockImplementation(() => Promise.resolve(h.workbench!));
  h.patch.mockImplementation(
    (_id: string, input: { storeListing: StoryWorkbench["project"]["storeListing"] }) => {
      const project = {
        ...h.workbench!.project,
        storeListing: input.storeListing,
        projectVersion: h.workbench!.project.projectVersion + 1,
      };
      h.workbench = { ...h.workbench!, project };
      return Promise.resolve(project);
    }
  );
  h.offline.mockResolvedValue({ gameId: PROJECT_ID, status: "offline", rejectReason: null });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  document.body.replaceChildren();
  sessionStorage.clear();
});

describe("project publication details dialog", () => {
  it("allows publication without promotional details", async () => {
    h.workbench!.project.cover = null;
    await render();
    await input("descriptionPlaceholder", "");
    expect(button("saveDraft").disabled).toBe(false);
    expect(button("submit").disabled).toBe(false);
    await click(button("saveDraft"));
    expect(h.patch).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        expectedProjectVersion: 3,
        storeListing: expect.objectContaining({ description: "" }),
      }),
      expect.any(AbortSignal)
    );
    expect(h.prepare).not.toHaveBeenCalled();
  });

  it("allows ready unreviewed promotional media", async () => {
    h.workbench!.project.cover!.moderationStatus = "unreviewed";
    await render();
    expect(button("submit").disabled).toBe(false);
  });

  it.each(["", "Original film team"])(
    "submits without a creator field while preserving its stored value %j",
    async (developer) => {
      h.workbench!.project.storeListing!.developer = developer;
      await render();
      expect(document.querySelector('input[placeholder="developerPlaceholder"]')).toBeNull();
      expect(document.body.textContent).not.toContain("fields.developer");
      expect(button("submit").disabled).toBe(false);
      await input("descriptionPlaceholder", "The updated introduction for review");
      await click(button("submit"));
      await click(button("actions.confirm"));
      expect(h.patch).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({
          storeListing: expect.objectContaining({
            description: "The updated introduction for review",
            developer,
          }),
        }),
        expect.any(AbortSignal)
      );
      expect(h.prepare).toHaveBeenCalledOnce();
      expect(h.submit).toHaveBeenCalledOnce();
    }
  );

  it("blocks an unresolved screenshot", async () => {
    h.workbench!.project.storeListing!.screenshotAssetIds = [SHOT_ID];
    await render();
    expect(button("submit").disabled).toBe(true);
    expect(document.body.textContent).toContain("mediaUnavailable");
  });

  it("allows a blank introduction to be saved and submitted", async () => {
    await render();
    await input("descriptionPlaceholder", "  ");
    expect(button("submit").disabled).toBe(false);
    expect(button("saveDraft").disabled).toBe(false);
    await click(button("saveDraft"));
    expect(h.patch).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        storeListing: expect.objectContaining({
          description: "",
        }),
      }),
      expect.any(AbortSignal)
    );
  });

  it.each(["reviewing", "published"] as const)(
    "keeps drafts editable and exposes the %s recovery action",
    async (status) => {
      h.getPublication.mockResolvedValue({ gameId: PROJECT_ID, status, rejectReason: null });
      await render();
      expect(field("descriptionPlaceholder").disabled).toBe(false);
      await input("descriptionPlaceholder", "A new draft description");
      expect(button("saveDraft").disabled).toBe(false);
      await click(button("saveDraft"));
      expect(h.patch).toHaveBeenCalledOnce();
      expect(
        [...document.querySelectorAll("button")].some(
          (node) => node.textContent?.trim() === "submit"
        )
      ).toBe(false);
      const action = status === "reviewing" ? "withdraw" : "offline";
      expect(button(action).disabled).toBe(false);
      if (status === "published")
        expect(document.querySelector<HTMLAnchorElement>("a")?.href).toBe(
          `https://fizzdragon.com/en-US/play/interactive-film/${PROJECT_ID}`
        );
      await click(button(action));
      h.getPublication.mockResolvedValue({
        gameId: PROJECT_ID,
        status: "offline",
        rejectReason: null,
      });
      await click(button(status === "reviewing" ? "withdraw.confirm" : "offline.confirm"));
      expect(h.offline).toHaveBeenCalledWith(PROJECT_ID, expect.any(AbortSignal));
    }
  );

  it("keeps the form and publish actions read-only without edit permission", async () => {
    h.workbench!.project.capabilities = ["story.read"];
    await render();
    expect(field("descriptionPlaceholder").disabled).toBe(true);
    expect(button("saveDraft").disabled).toBe(true);
    expect(button("submit").disabled).toBe(true);
    expect(h.getPublication).toHaveBeenCalledOnce();
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.offline).not.toHaveBeenCalled();
  });

  it("lets an editor read publication status while keeping submission disabled", async () => {
    h.workbench!.project.capabilities = ["story.read", "story.edit", "story.build"];
    h.getPublication.mockResolvedValue({
      gameId: PROJECT_ID,
      status: "published",
      rejectReason: null,
    });
    await render();
    expect(h.getPublication).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("status.published");
    expect(button("saveDraft").disabled).toBe(true);
    expect(
      [...document.querySelectorAll("button")].some(
        (node) => node.textContent?.trim() === "offline"
      )
    ).toBe(false);
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.offline).not.toHaveBeenCalled();
  });

  it("offers sign-in recovery for an expired publication session", async () => {
    h.getPublication.mockRejectedValue(Object.assign(Error("Session expired."), { status: 401 }));
    await render();
    expect(document.body.textContent).toContain("statusError.auth.label");
    expect(document.body.textContent).toContain("Session expired.");
    expect(button("submit").disabled).toBe(true);
    await click(button("statusError.signIn"));
    expect(h.signIn).toHaveBeenCalledOnce();
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("retains unsaved introduction edits across a return visit when the status service fails", async () => {
    h.getPublication.mockRejectedValue(new Error("Java is unavailable."));
    await render();
    await input("descriptionPlaceholder", "Keep this unfinished draft");
    expect(document.body.textContent).toContain("Java is unavailable.");
    expect(button("submit").disabled).toBe(true);
    expect(button("saveDraft").disabled).toBe(false);
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(field("descriptionPlaceholder").value).toBe("Keep this unfinished draft");
    await click(button("saveDraft"));
    expect(h.patch).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        storeListing: expect.objectContaining({ description: "Keep this unfinished draft" }),
      }),
      expect.any(AbortSignal)
    );
  });

  it("closes without saving or changing the route and retains dirty edits when reopened", async () => {
    await render();
    await input("descriptionPlaceholder", "My unfinished introduction");
    expect(document.body.textContent).toContain("closeDraftHint");
    await click(closeButton());
    expect(h.onOpenChange).toHaveBeenCalledWith(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
    await click(button("Open publication"));
    expect(field("descriptionPlaceholder").value).toBe("My unfinished introduction");
    expect(button("saveDraft").disabled).toBe(false);
    expect(h.patch).not.toHaveBeenCalled();
  });

  it("can close and reopen a recovered draft after edit permission was revoked", async () => {
    h.workbench!.project.capabilities = ["story.read"];
    const storageKey = `story-publication-draft:alice:${PROJECT_ID}`;
    const cached = {
      value: {
        coverAssetId: COVER_ID,
        listing: { ...h.workbench!.project.storeListing!, description: "Keep my earlier edits" },
      },
      projectVersion: 3,
    };
    sessionStorage.setItem(storageKey, JSON.stringify(cached));
    await render();
    expect(field("descriptionPlaceholder").value).toBe("Keep my earlier edits");
    expect(field("descriptionPlaceholder").disabled).toBe(true);
    await click(closeButton());
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual(cached);
    await click(button("Open publication"));
    expect(field("descriptionPlaceholder").value).toBe("Keep my earlier edits");
  });

  it("retains the upstream save failure across closing and reopening without another save", async () => {
    h.patch.mockRejectedValue(new Error("The project version changed."));
    await render();
    await input("descriptionPlaceholder", "My retained draft");
    await click(button("saveDraft"));
    expect(document.body.textContent).toContain("The project version changed.");
    expect(h.patch).toHaveBeenCalledOnce();
    await click(closeButton());
    await click(button("Open publication"));
    expect(field("descriptionPlaceholder").value).toBe("My retained draft");
    expect(document.body.textContent).toContain("The project version changed.");
    expect(h.patch).toHaveBeenCalledOnce();
    expect(h.push).not.toHaveBeenCalled();
    expect(button("saveDraft").disabled).toBe(false);
  });

  it("prevents dismissal during an explicit save, then allows closing when it settles", async () => {
    const saved = deferred<StoryWorkbench["project"]>();
    h.patch.mockReturnValue(saved.promise);
    await render();
    await input("descriptionPlaceholder", "A saved introduction");
    await click(button("saveDraft"));
    expect(closeButton().disabled).toBe(true);
    await escape();
    expect(h.onOpenChange).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () =>
      saved.resolve({
        ...h.workbench!.project,
        projectVersion: 4,
        storeListing: {
          ...h.workbench!.project.storeListing!,
          description: "A saved introduction",
        },
      })
    );
    await settle();
    expect(closeButton().disabled).toBe(false);
    await click(closeButton());
    expect(h.onOpenChange).toHaveBeenCalledWith(false);
    expect(h.patch).toHaveBeenCalledOnce();
    expect(h.push).not.toHaveBeenCalled();
  });

  it("keeps the outer dialog open when the submission confirmation is cancelled with Escape", async () => {
    await render();
    await click(button("submit"));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    expect(closeButton().disabled).toBe(true);
    await escape();
    expect(h.onOpenChange).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
    expect(closeButton().disabled).toBe(false);
    expect(document.activeElement).toBe(button("submit"));
    await escape();
    expect(h.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("saves the introduction before preparing review and prevents closing while preparation is pending", async () => {
    const prepared = deferred<{ gameId: string }>();
    h.prepare.mockReturnValue(prepared.promise);
    await render();
    await input("descriptionPlaceholder", "The version for review");
    await click(button("submit"));
    await click(button("actions.confirm"));
    expect(h.patch).toHaveBeenCalledOnce();
    expect(h.prepare).toHaveBeenCalledWith(
      PROJECT_ID,
      {
        expectedProjectVersion: 4,
        expectedDraftRevision: 7,
        expectedVideoSnapshotHash: "a".repeat(64),
      },
      expect.any(AbortSignal)
    );
    expect(closeButton().disabled).toBe(true);
    await escape();
    expect(h.onOpenChange).not.toHaveBeenCalled();
    h.getPublication.mockResolvedValue({
      gameId: PROJECT_ID,
      status: "reviewing",
      rejectReason: null,
    });
    await act(async () => prepared.resolve({ gameId: PROJECT_ID }));
    await settle();
    expect(h.submit).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("status.reviewing");
    expect(button("withdraw").disabled).toBe(false);
    expect(closeButton().disabled).toBe(false);
  });

  it("prevents closing during an offline request and retains the recovery dialog", async () => {
    const offlined = deferred<{ gameId: string; status: string; rejectReason: null }>();
    h.getPublication.mockResolvedValue({
      gameId: PROJECT_ID,
      status: "published",
      rejectReason: null,
    });
    h.offline.mockReturnValue(offlined.promise);
    await render();
    await click(button("offline"));
    expect(closeButton().disabled).toBe(true);
    await click(button("offline.confirm"));
    await escape();
    expect(h.onOpenChange).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    expect(h.offline).toHaveBeenCalledOnce();
    h.getPublication.mockResolvedValue({
      gameId: PROJECT_ID,
      status: "offline",
      rejectReason: null,
    });
    await act(async () =>
      offlined.resolve({ gameId: PROJECT_ID, status: "offline", rejectReason: null })
    );
    await settle();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(closeButton().disabled).toBe(false);
  });

  it("keeps each account's unfinished introduction isolated across close and account switches", async () => {
    await render();
    await input("descriptionPlaceholder", "Alice's unfinished introduction");
    await click(closeButton());
    h.user = { id: "bob" };
    await render();
    await click(button("Open publication"));
    expect(field("descriptionPlaceholder").value).toBe("Find your story");
    await input("descriptionPlaceholder", "Bob's unfinished introduction");
    await click(closeButton());
    h.user = { id: "alice" };
    await render();
    await click(button("Open publication"));
    expect(field("descriptionPlaceholder").value).toBe("Alice's unfinished introduction");
    expect(sessionStorage.getItem(`story-publication-draft:bob:${PROJECT_ID}`)).toContain(
      "Bob's unfinished introduction"
    );
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
  });

  it("saves dirty details before locating an incomplete chapter and allows reopening afterward", async () => {
    h.workbench!.chapters[0]!.entryNodeId = null;
    const saved = deferred<StoryWorkbench["project"]>();
    h.patch.mockReturnValue(saved.promise);
    await render();
    await input("descriptionPlaceholder", "Keep this introduction before navigating");
    await click(button("Opening"));
    expect(h.patch).toHaveBeenCalledOnce();
    expect(h.onOpenChange).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
    expect(closeButton().disabled).toBe(true);
    await act(async () =>
      saved.resolve({
        ...h.workbench!.project,
        projectVersion: 4,
        storeListing: {
          ...h.workbench!.project.storeListing!,
          description: "Keep this introduction before navigating",
        },
      })
    );
    await settle();
    expect(h.onOpenChange).toHaveBeenCalledWith(false);
    expect(h.push).toHaveBeenCalledWith(
      `/story-studio/projects/${PROJECT_ID}/canvas?chapter=${CHAPTER_ID}`
    );
    await click(button("Open publication"));
    expect(closeButton().disabled).toBe(false);
    expect(field("descriptionPlaceholder").value).toBe("Keep this introduction before navigating");
    expect(h.patch).toHaveBeenCalledOnce();
  });

  it("waits for introduction saving and the latest live canvas save before navigation, retaining the dialog on canvas failure", async () => {
    h.workbench!.chapters[0]!.entryNodeId = null;
    const introduction = deferred<StoryWorkbench["project"]>();
    const canvas = deferred<void>();
    const previousBarrier = vi.fn(async (submit: (revision: number) => Promise<unknown>) =>
      submit(7)
    );
    const currentBarrier = vi.fn(async (submit: (revision: number) => Promise<unknown>) => {
      await canvas.promise;
      return submit(8);
    });
    h.draftBarrier = previousBarrier;
    h.patch.mockReturnValue(introduction.promise);
    await render();
    await input("descriptionPlaceholder", "Introduction saved before leaving");
    await click(button("Opening"));
    expect(h.patch).toHaveBeenCalledOnce();
    expect(previousBarrier).not.toHaveBeenCalled();
    h.draftBarrier = currentBarrier;
    await render();
    expect(currentBarrier).not.toHaveBeenCalled();
    await act(async () =>
      introduction.resolve({
        ...h.workbench!.project,
        projectVersion: 4,
        storeListing: {
          ...h.workbench!.project.storeListing!,
          description: "Introduction saved before leaving",
        },
      })
    );
    await settle();
    expect(previousBarrier).not.toHaveBeenCalled();
    expect(currentBarrier).toHaveBeenCalledOnce();
    expect(closeButton().disabled).toBe(true);
    expect(h.onOpenChange).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
    await act(async () => canvas.reject(Error("The current canvas draft could not be saved.")));
    await settle();
    expect(h.error).toHaveBeenCalledWith("The current canvas draft could not be saved.");
    expect(h.onOpenChange).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(field("descriptionPlaceholder").value).toBe("Introduction saved before leaving");
    expect(closeButton().disabled).toBe(false);
  });

  it.each(["completed", "aborted"])(
    "ignores an old account's %s introduction save while navigating without changing the new account's dialog",
    async (outcome) => {
      h.workbench!.chapters[0]!.entryNodeId = null;
      const introduction = deferred<StoryWorkbench["project"]>();
      const canvasBarrier = vi.fn(async (submit: (revision: number) => Promise<unknown>) =>
        submit(8)
      );
      h.draftBarrier = canvasBarrier;
      h.patch.mockReturnValue(introduction.promise);
      await render();
      await input("descriptionPlaceholder", "Alice's introduction being saved");
      await click(button("Opening"));
      expect(h.patch).toHaveBeenCalledOnce();
      const signal = h.patch.mock.calls[0]![2] as AbortSignal;
      h.user = { id: "bob" };
      await render();
      expect(signal.aborted).toBe(true);
      expect(field("descriptionPlaceholder").value).toBe("Find your story");
      await input("descriptionPlaceholder", "Bob's own introduction");
      await act(async () => {
        if (outcome === "aborted") {
          introduction.reject(new DOMException("Alice's save was abandoned", "AbortError"));
        } else {
          introduction.resolve({
            ...h.workbench!.project,
            projectVersion: 4,
            storeListing: {
              ...h.workbench!.project.storeListing!,
              description: "Alice's introduction being saved",
            },
          });
        }
      });
      await settle();
      expect(canvasBarrier).not.toHaveBeenCalled();
      expect(h.onOpenChange).not.toHaveBeenCalled();
      expect(h.push).not.toHaveBeenCalled();
      expect(h.error).not.toHaveBeenCalled();
      expect(field("descriptionPlaceholder").value).toBe("Bob's own introduction");
      expect(closeButton().disabled).toBe(false);
      expect(sessionStorage.getItem(`story-publication-draft:alice:${PROJECT_ID}`)).toContain(
        "Alice's introduction being saved"
      );
    }
  );
});

function Harness() {
  const [open, setOpen] = useState(true);
  const query = useQuery({
    queryKey: ["story-studio", "chapter-workbench", PROJECT_ID, CHAPTER_ID, h.user?.id ?? null],
    queryFn: () => Promise.resolve(h.workbench!),
    initialData: () => h.workbench!,
    staleTime: Infinity,
  });
  return (
    <>
      <button onClick={() => setOpen(true)}>Open publication</button>
      <StoryPublicationDetailsDialog
        projectId={PROJECT_ID}
        open={open}
        onOpenChange={(next) => {
          h.onOpenChange(next);
          setOpen(next);
        }}
        workbench={query.data ?? undefined}
        loading={h.loading}
        error={h.loadError}
        onRetry={h.retry}
      />
    </>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function closeButton(): HTMLButtonElement {
  const close = document.querySelector<HTMLButtonElement>(
    '[data-slot="publication-details-close"]'
  );
  if (!close) throw new Error("Publication details close button was not rendered");
  return close;
}
async function settle() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 30));
  });
}
async function escape() {
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  );
  await settle();
}

async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <Harness />
        </TooltipProvider>
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
async function click(target: HTMLButtonElement) {
  await act(async () => target.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === text
  );
  if (!found) throw new Error(`Button ${text} was not rendered`);
  return found;
}
function field(placeholder: string): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>(`textarea[placeholder="${placeholder}"]`)!;
}
async function input(placeholder: string, value: string) {
  const target = field(placeholder);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      target,
      value
    );
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function asset(id: string): MediaAssetSummary {
  return {
    id,
    kind: "image",
    status: "ready",
    moderationStatus: "approved",
    contentType: "image/jpeg",
    width: 800,
    height: 600,
    durationSeconds: null,
    checksumSha256: null,
    previewUrl: `https://media.example/${id}.jpg`,
  };
}
