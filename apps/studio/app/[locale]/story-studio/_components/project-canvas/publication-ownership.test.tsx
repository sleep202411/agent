// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStoryPublication } from "./use-story-publication";
import type { StoryCapability, StoryWorkbench } from "@/lib/story-projects-api";
const h = vi.hoisted(() => ({
  user: "alice",
  prepare: vi.fn(),
  read: vi.fn(),
  submit: vi.fn(),
  cache: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: h.user }, isCurrentAccount: (id: string) => id === h.user }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: h.cache, invalidateQueries: h.invalidate }),
}));
vi.mock("@/lib/interactive-film-api", () => ({
  getInteractiveFilmPublication: h.read,
  prepareInteractiveFilmRelease: h.prepare,
  submitInteractiveFilmRelease: h.submit,
  interactiveFilmPublicationQueryKey: (id: string, user: string) => ["publication", id, user],
}));
let root: Root, host: HTMLDivElement, hook: ReturnType<typeof useStoryPublication>;
let projectId: string, capabilities: StoryCapability[];
let save: (submit: (revision: number) => Promise<unknown>) => Promise<unknown>;
let beforePrepareRelease: (() => Promise<StoryWorkbench | void>) | undefined;
let submitBlockedReason: string | null;
function Harness() {
  const value = useStoryPublication({
    projectId,
    capabilities,
    expectedProjectVersion: 2,
    expectedDraftRevision: 3,
    expectedVideoSnapshotHash: "a".repeat(64),
    withSavedDraftSnapshot: save as never,
    beforePrepareRelease,
    submitBlockedReason,
    readPublicationStatus: h.read,
  });
  useLayoutEffect(() => {
    hook = value;
  });
  return <span>{value.state.status}</span>;
}
async function render() {
  await act(async () => root.render(<Harness />));
}
function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  h.user = "alice";
  projectId = "one";
  capabilities = ["story.edit", "story.build", "story.release"];
  save = (submit) => submit(3);
  beforePrepareRelease = undefined;
  submitBlockedReason = null;
  h.prepare.mockResolvedValue({ gameId: "one" });
  h.read.mockResolvedValue(null);
  h.submit.mockResolvedValue({ gameId: "one", status: "reviewing" });
  h.invalidate.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("does not prepare a release after navigating away during save", async () => {
  const saved = deferred();
  save = async (submit) => {
    await saved.promise;
    return submit(3);
  };
  await render();
  let run!: Promise<void>;
  act(() => {
    run = hook.confirm();
  });
  await act(async () => {
    await Promise.resolve();
  });
  const cacheWritesBeforeLeaving = h.cache.mock.calls.length;
  act(() => root.render(null));
  await act(async () => {
    saved.resolve(null);
    await run;
  });
  expect(h.prepare).not.toHaveBeenCalled();
  expect(h.cache).toHaveBeenCalledTimes(cacheWritesBeforeLeaving);
});
it.each(["account", "project", "permission", "status"])(
  "does not submit a prepared release after changing %s",
  async (change) => {
    const prepared = deferred();
    h.prepare.mockReturnValue(prepared.promise);
    await render();
    let run!: Promise<void>;
    await act(async () => {
      run = hook.confirm();
      await Promise.resolve();
    });
    const signal = h.prepare.mock.calls[0]![2] as AbortSignal;
    const writesBeforeAbandonment = h.cache.mock.calls.length;
    if (change === "account") h.user = "bob";
    if (change === "project") projectId = "two";
    if (change === "permission") capabilities = [];
    if (change === "status") submitBlockedReason = "Already reviewing";
    await render();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      prepared.resolve({ gameId: "one" });
      await run;
    });
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.cache).toHaveBeenCalledTimes(writesBeforeAbandonment);
    expect(hook.state.status).toBe("closed");
  }
);

it("saves introduction edits before the canvas snapshot and prepares with the updated project version", async () => {
  const calls: string[] = [];
  beforePrepareRelease = vi.fn(async () => {
    calls.push("introduction");
    return {
      project: { id: "one", projectVersion: 9 },
      draft: { revision: 7 },
      video: { snapshotHash: "b".repeat(64) },
    } as StoryWorkbench;
  });
  save = async (submit) => {
    calls.push("canvas");
    return submit(8);
  };
  await render();
  await act(async () => hook.confirm());
  expect(calls).toEqual(["introduction", "canvas"]);
  expect(h.prepare).toHaveBeenCalledWith(
    "one",
    {
      expectedProjectVersion: 9,
      expectedDraftRevision: 8,
      expectedVideoSnapshotHash: "b".repeat(64),
    },
    expect.any(AbortSignal)
  );
});

it("retains introduction save failures without building or submitting", async () => {
  beforePrepareRelease = vi.fn(async () => {
    throw new Error("Introduction version changed.");
  });
  const saveCanvas = vi.fn(save);
  save = saveCanvas;
  await render();
  await act(async () => hook.confirm());
  expect(hook.state).toMatchObject({
    status: "failed",
    phase: "saving",
    message: "Introduction version changed.",
  });
  expect(saveCanvas).not.toHaveBeenCalled();
  expect(h.prepare).not.toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
});
it("suppresses a late submission result after account replacement", async () => {
  const submitted = deferred();
  h.submit.mockReturnValue(submitted.promise);
  await render();
  let run!: Promise<void>;
  await act(async () => {
    run = hook.confirm();
    await Promise.resolve();
  });
  const writesBeforeAbandonment = h.cache.mock.calls.length;
  h.user = "bob";
  await render();
  await act(async () => {
    submitted.resolve({ status: "reviewing" });
    await run;
  });
  expect(h.cache).toHaveBeenCalledTimes(writesBeforeAbandonment);
  expect(h.invalidate).not.toHaveBeenCalled();
});
it("preserves a current failure and allows retry into the account-scoped cache", async () => {
  h.prepare.mockRejectedValueOnce(Error("Release unavailable"));
  await render();
  await act(async () => hook.confirm());
  expect(hook.state).toMatchObject({ status: "failed", message: "Release unavailable" });
  await act(async () => hook.retry());
  expect(hook.state.status).toBe("succeeded");
  expect(h.cache).toHaveBeenCalledWith(
    ["publication", "one", "alice"],
    expect.objectContaining({ status: "reviewing" })
  );
});
it("prevents duplicate confirmation while preparation is pending", async () => {
  const prepared = deferred();
  h.prepare.mockReturnValue(prepared.promise);
  await render();
  let run!: Promise<void>;
  await act(async () => {
    run = hook.confirm();
    void hook.confirm();
    await Promise.resolve();
  });
  expect(h.prepare).toHaveBeenCalledOnce();
  await act(async () => {
    prepared.resolve({ gameId: "one" });
    await run;
  });
  expect(h.submit).toHaveBeenCalledOnce();
});

it("does not save, prepare or submit when project status authorization fails, including retry", async () => {
  h.read.mockRejectedValue(
    Object.assign(Error("Missing project read capability"), {
      status: 403,
      code: "STORY_PERMISSION_DENIED",
    })
  );
  const saved = vi.fn(save);
  save = saved;
  await render();
  await act(async () => hook.confirm());
  expect(hook.state).toMatchObject({
    status: "failed",
    errorKind: "permission",
    message: "Missing project read capability",
  });
  await act(async () => hook.retry());
  expect(h.read).toHaveBeenCalledTimes(2);
  expect(saved).not.toHaveBeenCalled();
  expect(h.prepare).not.toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
});

it("does not prepare or submit when the authoritative status read fails, including retries", async () => {
  h.read.mockRejectedValue(Error("Publication status could not be checked."));
  await render();
  await act(async () => hook.confirm());
  expect(hook.state).toMatchObject({
    status: "failed",
    message: "Publication status could not be checked.",
  });
  await act(async () => hook.retry());
  expect(h.read).toHaveBeenCalledTimes(2);
  expect(h.prepare).not.toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
});

it("checks authoritative publication status before preparing a stale draft", async () => {
  h.read.mockResolvedValue({ gameId: "one", status: "published", rejectReason: null });
  await render();
  await act(async () => hook.confirm());
  expect(hook.state).toMatchObject({ status: "failed", message: "publishedUpdateLocked" });
  expect(h.prepare).not.toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
});

it("retains pending while reconciling an uncertain submission and blocks retrying a completed review", async () => {
  const reconciled = deferred();
  const reviewing = { gameId: "one", status: "reviewing", rejectReason: null };
  h.read
    .mockResolvedValueOnce(null)
    .mockReturnValueOnce(reconciled.promise)
    .mockResolvedValue(reviewing);
  h.submit.mockRejectedValueOnce(
    Object.assign(Error("Gateway response interrupted"), {
      status: 503,
      code: "STORY_PUBLICATION_SERVICE_UNAVAILABLE",
    })
  );
  await render();
  let run!: Promise<void>;
  await act(async () => {
    run = hook.confirm();
    await Promise.resolve();
  });
  expect(h.read).toHaveBeenCalledTimes(2);
  expect(hook.isPending).toBe(true);
  await act(async () => hook.retry());
  expect(h.prepare).toHaveBeenCalledOnce();
  await act(async () => {
    reconciled.resolve(reviewing);
    await run;
  });
  expect(hook.state).toMatchObject({
    status: "failed",
    errorKind: "service",
    message: "Gateway response interrupted",
  });
  expect(h.cache).toHaveBeenCalledWith(["publication", "one", "alice"], reviewing);
  await act(async () => hook.retry());
  expect(h.prepare).toHaveBeenCalledOnce();
  expect(h.submit).toHaveBeenCalledOnce();
});

it("permits a fresh retry when a submit POST failed and an authoritative read confirms no publication", async () => {
  h.submit.mockRejectedValueOnce(Error("Review submission POST failed."));
  await render();
  await act(async () => hook.confirm());
  expect(hook.state).toMatchObject({ status: "failed", phase: "submitting" });
  await act(async () => hook.retry());
  expect(h.read).toHaveBeenCalledTimes(3);
  expect(h.prepare).toHaveBeenCalledTimes(2);
  expect(h.submit).toHaveBeenCalledTimes(2);
  expect(hook.state.status).toBe("succeeded");
});
