// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryWorkbench } from "@/lib/story-projects-api";
import { ApiRequestError } from "@/lib/api";
import { projectPublicationDraft } from "../_lib/story-publication-draft";
import { storyChapterWorkbenchQueryKey } from "../_lib/use-story-chapter-workbench";
import { useStoryPublicationDraft } from "./use-story-publication-draft";

const h = vi.hoisted(() => ({ userId: "alice", patch: vi.fn(), get: vi.fn() }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: h.userId }, isCurrentAccount: (id: string) => id === h.userId }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/story-projects-api", async (original) => ({
  ...(await original<typeof import("@/lib/story-projects-api")>()),
  updateStoryProject: h.patch,
  getStoryWorkbench: h.get,
}));

let host: HTMLDivElement,
  root: Root,
  client: QueryClient,
  hook: ReturnType<typeof useStoryPublicationDraft>,
  workbench: StoryWorkbench;
const chapterId = "chapter-one";
const projectId = "project-one";
const storageKey = (account = "alice") => `story-publication-draft:${account}:${projectId}`;
function projection(version: number, description = "Server film"): StoryWorkbench {
  return {
    project: {
      id: projectId,
      projectVersion: version,
      capabilities: ["story.edit", "story.build", "story.release"],
      storeListing: {
        description,
        tags: [],
        developer: "",
        trailerAssetId: null,
        screenshotAssetIds: [],
      },
      cover: null,
    },
    chapter: { id: chapterId },
    draft: { revision: 3 },
    video: { snapshotHash: "a".repeat(64) },
  } as unknown as StoryWorkbench;
}
function legacyListing(title: string) {
  return {
    tagline: title,
    shortDescription: "",
    aboutParagraphs: [],
    tags: [],
    developer: "",
    trailerAssetId: null,
    screenshotAssetIds: [],
  };
}
function Harness() {
  const value = useStoryPublicationDraft(projectId, workbench);
  useLayoutEffect(() => {
    hook = value;
  });
  return (
    <span>
      {value.value.listing.description}:{String(value.saving)}
    </span>
  );
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
async function editDescription(description = "My local film") {
  await act(async () =>
    hook.update({ ...hook.value, listing: { ...hook.value.listing, description } })
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (failure: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  h.userId = "alice";
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  workbench = projection(1);
  h.patch.mockImplementation(async (_project, input) => ({
    ...workbench.project,
    projectVersion: input.expectedProjectVersion + 1,
    storeListing: input.storeListing,
  }));
  h.get.mockImplementation(async () => workbench);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.restoreAllMocks();
});

describe("publication draft editing and release snapshots", () => {
  it("migrates a recovered legacy draft and sends only merged tags while retaining unsaved text", async () => {
    const draft = projectPublicationDraft(workbench.project);
    const legacy = {
      ...draft,
      listing: {
        ...legacyListing("Unsaved legacy film"),
        shortDescription: "Saved summary",
        aboutParagraphs: ["First paragraph\nSecond line", "Repeated", "Repeated"],
        genres: ["Drama", "Mystery"],
        tags: ["Mystery", "Choices"],
      },
    };
    sessionStorage.setItem(storageKey(), JSON.stringify({ value: legacy, projectVersion: 1 }));
    await render();
    expect(hook.value.listing.tags).toEqual(["Drama", "Mystery", "Choices"]);
    expect(hook.value.listing).not.toHaveProperty("genres");
    const description =
      "Unsaved legacy film\n\nSaved summary\n\nFirst paragraph\nSecond line\n\nRepeated\n\nRepeated";
    expect(hook.value.listing.description).toBe(description);
    expect(hook.dirty).toBe(true);
    expect(hook.valid).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(storageKey())!).value.listing).not.toHaveProperty(
      "genres"
    );
    await act(async () => hook.save());
    expect(h.patch.mock.calls[0]![1].storeListing).toMatchObject({
      description,
      tags: ["Drama", "Mystery", "Choices"],
    });
    expect(h.patch.mock.calls[0]![1].storeListing).not.toHaveProperty("genres");
    for (const field of ["tagline", "shortDescription", "aboutParagraphs"])
      expect(h.patch.mock.calls[0]![1].storeListing).not.toHaveProperty(field);
    expect(hook.dirty).toBe(false);
  });

  it("does not treat the format migration of an unchanged legacy workbench as unsaved editing", async () => {
    workbench = {
      ...workbench,
      project: {
        ...workbench.project,
        storeListing: {
          ...legacyListing(workbench.project.storeListing!.description),
          genres: ["Drama"],
          tags: ["Drama", "Choices"],
        },
      },
    } as unknown as StoryWorkbench;
    const legacy = { coverAssetId: null, listing: workbench.project.storeListing };
    sessionStorage.setItem(storageKey(), JSON.stringify({ value: legacy, projectVersion: 1 }));
    await render();
    expect(hook.value.listing.tags).toEqual(["Drama", "Choices"]);
    expect(hook.dirty).toBe(false);
    expect(sessionStorage.getItem(storageKey())).toBeNull();
    await act(async () => hook.save());
    expect(h.patch).not.toHaveBeenCalled();
  });

  it("migrates legacy values in an already mounted edit state while keeping unsaved changes", async () => {
    await render();
    const legacy = {
      ...hook.value,
      listing: {
        ...legacyListing("Retained during refresh"),
        genres: ["Drama"],
        tags: ["Drama", "Choices"],
      },
    };
    await act(async () => hook.update(legacy as unknown as typeof hook.value));
    await render();
    expect(hook.value.listing.description).toBe("Retained during refresh");
    expect(hook.value.listing.tags).toEqual(["Drama", "Choices"]);
    expect(hook.value.listing).not.toHaveProperty("genres");
    expect(hook.dirty).toBe(true);
    expect(hook.valid).toBe(true);
  });

  it("retains over-limit migrated tags but prevents saving until they are corrected", async () => {
    const draft = projectPublicationDraft(workbench.project);
    const legacy = {
      ...draft,
      listing: {
        ...draft.listing,
        description: "Keep my draft",
        genres: ["Drama"],
        tags: Array.from({ length: 12 }, (_, index) => `Tag ${index + 1}`),
      },
    };
    sessionStorage.setItem(storageKey(), JSON.stringify({ value: legacy, projectVersion: 1 }));
    await render();
    expect(hook.value.listing.tags).toHaveLength(13);
    expect(hook.value.listing.description).toBe("Keep my draft");
    expect(hook.valid).toBe(false);
    await act(async () => {
      await expect(hook.save()).rejects.toThrow("invalidDraft");
    });
    expect(h.patch).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(storageKey())!).value.listing.tags).toHaveLength(13);
  });

  it("recovers an incomplete session draft and retains its conflict against a newer server version", async () => {
    const value = projectPublicationDraft(projection(1, "Recovered film").project);
    sessionStorage.setItem(storageKey(), JSON.stringify({ value, projectVersion: 1 }));
    workbench = projection(2);
    await render();
    expect(hook.value.listing.description).toBe("Recovered film");
    expect(hook.valid).toBe(true);
    expect(hook.dirty).toBe(true);
    expect(hook.conflicted).toBe(true);
  });

  it("saves partial details once, keeps the successful result when old server props render, and updates only this account's cache", async () => {
    const aliceKey = storyChapterWorkbenchQueryKey(projectId, chapterId, "alice");
    const bobKey = storyChapterWorkbenchQueryKey(projectId, chapterId, "bob");
    client.setQueryData(aliceKey, workbench);
    client.setQueryData(bobKey, workbench);
    await render();
    await editDescription();
    const patched = deferred<StoryWorkbench["project"]>();
    h.patch.mockReturnValue(patched.promise);
    let first!: Promise<StoryWorkbench>, second!: Promise<StoryWorkbench>;
    await act(async () => {
      first = hook.save();
      second = hook.save();
    });
    expect(h.patch).toHaveBeenCalledOnce();
    const saved = projection(2, "My local film");
    await act(async () => {
      patched.resolve(saved.project);
      await Promise.all([first, second]);
    });
    await render();
    expect(hook.value.listing.description).toBe("My local film");
    expect(hook.dirty).toBe(false);
    expect(sessionStorage.getItem(storageKey())).toBeNull();
    expect(client.getQueryData<StoryWorkbench>(aliceKey)?.project.projectVersion).toBe(2);
    expect(client.getQueryData<StoryWorkbench>(bobKey)?.project.projectVersion).toBe(1);
    expect(h.patch.mock.calls[0]![1]).toMatchObject({
      expectedProjectVersion: 1,
      storeListing: { description: "My local film", developer: "" },
    });
  });

  it("reads a fresh chapter snapshot before release even when details have no changes", async () => {
    await render();
    const fresh = {
      ...workbench,
      draft: { ...workbench.draft, revision: 8 },
      video: { snapshotHash: "b".repeat(64) },
    };
    h.get.mockResolvedValue(fresh);
    let result!: StoryWorkbench;
    await act(async () => {
      result = await hook.prepareSnapshot();
    });
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.get).toHaveBeenCalledWith(projectId, chapterId, expect.any(AbortSignal));
    expect(result.draft.revision).toBe(8);
    expect(result.video.snapshotHash).toBe("b".repeat(64));
  });

  it("keeps just-saved details while the release snapshot read fails and allows retry without another patch", async () => {
    await render();
    await editDescription();
    h.get.mockRejectedValueOnce(Error("Could not refresh the chapter."));
    await act(async () => {
      await expect(hook.prepareSnapshot()).rejects.toThrow("Could not refresh the chapter.");
    });
    expect(hook.value.listing.description).toBe("My local film");
    expect(hook.dirty).toBe(false);
    expect(hook.error).toBe("Could not refresh the chapter.");
    expect(hook.saving).toBe(false);
    h.get.mockResolvedValue(projection(2, "My local film"));
    await act(async () => hook.prepareSnapshot());
    expect(h.patch).toHaveBeenCalledOnce();
    expect(hook.error).toBeNull();
  });

  it("preserves local edits after a concurrent update, then refreshes the version explicitly before saving", async () => {
    await render();
    await editDescription();
    workbench = projection(2, "Another creator's film");
    await render();
    expect(hook.value.listing.description).toBe("My local film");
    expect(hook.conflicted).toBe(true);
    await act(async () => {
      await expect(hook.save()).rejects.toThrow("conflict");
    });
    expect(h.patch).not.toHaveBeenCalled();
    const fresh = projection(3, "Newest server film");
    h.get.mockResolvedValue(fresh);
    await act(async () => hook.refreshAndKeepDraft());
    workbench = fresh;
    await render();
    expect(hook.value.listing.description).toBe("My local film");
    expect(hook.conflicted).toBe(false);
    expect(hook.dirty).toBe(true);
    await act(async () => hook.save());
    expect(h.patch.mock.calls[0]![1].expectedProjectVersion).toBe(3);
  });

  it("does not accept field updates while a save is pending", async () => {
    await render();
    await editDescription();
    const patched = deferred<StoryWorkbench["project"]>();
    h.patch.mockReturnValue(patched.promise);
    let saved!: Promise<StoryWorkbench>;
    await act(async () => {
      saved = hook.save();
      hook.update({
        ...hook.value,
        listing: { ...hook.value.listing, description: "A later change" },
      });
    });
    expect(hook.value.listing.description).toBe("My local film");
    await act(async () => {
      patched.resolve(projection(2, "My local film").project);
      await saved;
    });
    expect(hook.value.listing.description).toBe("My local film");
  });

  it("aborts an old account save and keeps each account's recovered inputs separate", async () => {
    await render();
    await editDescription("Alice's draft");
    const patched = deferred<StoryWorkbench["project"]>();
    h.patch.mockReturnValue(patched.promise);
    let saved!: Promise<StoryWorkbench>;
    await act(async () => {
      saved = hook.save();
    });
    const signal = h.patch.mock.calls[0]![2] as AbortSignal;
    h.userId = "bob";
    await render();
    expect(signal.aborted).toBe(true);
    expect(hook.value.listing.description).toBe("Server film");
    expect(hook.saving).toBe(false);
    expect(sessionStorage.getItem(storageKey("bob"))).toBeNull();
    expect(sessionStorage.getItem(storageKey("alice"))).toContain("Alice's draft");
    await act(async () => {
      patched.resolve(projection(2, "Alice's draft").project);
      await expect(saved).rejects.toMatchObject({ name: "AbortError" });
    });
    expect(hook.value.listing.description).toBe("Server film");
    expect(
      client.getQueryData(storyChapterWorkbenchQueryKey(projectId, chapterId, "bob"))
    ).toBeUndefined();
  });

  it.each(["account", "unmount"])(
    "abandons a release snapshot after %s without writing the late result into cache",
    async (change) => {
      await render();
      const fresh = deferred<StoryWorkbench>();
      h.get.mockReturnValue(fresh.promise);
      let snapshot!: Promise<StoryWorkbench>;
      await act(async () => {
        snapshot = hook.prepareSnapshot();
      });
      const signal = h.get.mock.calls[0]![2] as AbortSignal;
      if (change === "account") {
        h.userId = "bob";
        await render();
      } else await act(async () => root.render(null));
      expect(signal.aborted).toBe(true);
      await act(async () => {
        fresh.resolve(projection(2, "Late server film"));
        await expect(snapshot).rejects.toMatchObject({ name: "AbortError" });
      });
      expect(
        client.getQueryData(storyChapterWorkbenchQueryKey(projectId, chapterId, "alice"))
      ).toBeUndefined();
    }
  );

  it("retains failed saves and recovery data when the server reports a revision conflict", async () => {
    await render();
    await editDescription();
    h.patch.mockRejectedValueOnce(Error("Project version changed. Refresh before saving."));
    await act(async () => {
      await expect(hook.save()).rejects.toThrow("Project version changed.");
    });
    expect(hook.error).toBe("Project version changed. Refresh before saving.");
    expect(hook.dirty).toBe(true);
    expect(sessionStorage.getItem(storageKey())).toContain("My local film");
  });

  it.each([
    new ApiRequestError(
      "STORY_PROJECT_VERSION_CONFLICT",
      "Project version changed. Refresh before saving.",
      200
    ),
    new ApiRequestError(409, "Project version changed. Refresh before saving.", 409),
  ])(
    "offers conflict recovery immediately after a PATCH conflict even while workbench props remain stale",
    async (failure) => {
      await render();
      await editDescription();
      h.patch.mockRejectedValueOnce(failure);
      await act(async () => {
        await expect(hook.save()).rejects.toThrow("Project version changed.");
      });
      expect(workbench.project.projectVersion).toBe(1);
      expect(hook.conflicted).toBe(true);
      expect(hook.value.listing.description).toBe("My local film");
      await act(async () => {
        await expect(hook.save()).rejects.toThrow("conflict");
      });
      expect(h.patch).toHaveBeenCalledOnce();

      const fresh = projection(2, "Another creator's film");
      h.get.mockResolvedValueOnce(fresh);
      await act(async () => hook.refreshAndKeepDraft());
      workbench = fresh;
      await render();
      expect(hook.conflicted).toBe(false);
      expect(hook.value.listing.description).toBe("My local film");
      expect(hook.dirty).toBe(true);
      await act(async () => hook.save());
      expect(h.patch.mock.calls[1]![1].expectedProjectVersion).toBe(2);
    }
  );

  it("does not classify a snapshot GET failure as an introduction PATCH conflict", async () => {
    await render();
    h.get.mockRejectedValueOnce(new ApiRequestError(409, "Snapshot temporarily changed.", 409));
    await act(async () => {
      await expect(hook.prepareSnapshot()).rejects.toThrow("Snapshot temporarily changed.");
    });
    expect(hook.conflicted).toBe(false);
  });

  it("still saves to the server when session storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage disabled");
    });
    await render();
    await editDescription();
    await act(async () => hook.save());
    expect(hook.dirty).toBe(false);
    expect(h.patch).toHaveBeenCalledOnce();
  });
});
