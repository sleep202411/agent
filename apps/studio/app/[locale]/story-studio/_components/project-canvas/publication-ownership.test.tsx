// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStoryPublication } from "./use-story-publication";
import type { StoryCapability } from "@/lib/story-projects-api";
const h = vi.hoisted(() => ({
  user: "alice",
  prepare: vi.fn(),
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
  prepareInteractiveFilmRelease: h.prepare,
  submitInteractiveFilmRelease: h.submit,
  interactiveFilmPublicationQueryKey: (id: string, user: string) => ["publication", id, user],
}));
let root: Root, host: HTMLDivElement, hook: ReturnType<typeof useStoryPublication>;
let projectId: string, capabilities: StoryCapability[];
let save: (submit: (revision: number) => Promise<unknown>) => Promise<unknown>;
function Harness() {
  const value = useStoryPublication({
    projectId,
    capabilities,
    expectedVideoSnapshotHash: "a".repeat(64),
    withSavedDraftSnapshot: save as never,
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
  h.prepare.mockResolvedValue({ gameId: "one" });
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
  act(() => root.render(null));
  await act(async () => {
    saved.resolve(null);
    await run;
  });
  expect(h.prepare).not.toHaveBeenCalled();
  expect(h.cache).not.toHaveBeenCalled();
});
it.each(["account", "project", "permission"])(
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
    if (change === "account") h.user = "bob";
    if (change === "project") projectId = "two";
    if (change === "permission") capabilities = [];
    await render();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      prepared.resolve({ gameId: "one" });
      await run;
    });
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.cache).not.toHaveBeenCalled();
    expect(hook.state.status).toBe("closed");
  }
);
it("suppresses a late submission result after account replacement", async () => {
  const submitted = deferred();
  h.submit.mockReturnValue(submitted.promise);
  await render();
  let run!: Promise<void>;
  await act(async () => {
    run = hook.confirm();
    await Promise.resolve();
  });
  h.user = "bob";
  await render();
  await act(async () => {
    submitted.resolve({ status: "reviewing" });
    await run;
  });
  expect(h.cache).not.toHaveBeenCalled();
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
