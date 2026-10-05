import { act, createElement, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentChatRoute } from "./use-agent-chat-route";
const auth = vi.hoisted(() => ({ token: "alice", enabled: true }));
vi.mock("@/auth/use-auth", () => ({
  useAuth: () => ({
    status: auth.enabled ? "authenticated" : "anonymous",
    user: { id: "alice" },
    session: { token: { tokenName: "satoken", tokenValue: auth.token } },
  }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const send = vi.fn<() => Promise<boolean>>();
const restore = vi.fn<() => Promise<void>>();
let root: Root | undefined;
let hook: ReturnType<typeof useAgentChatRoute>;
let chapterId = "chapter-a";
let projectId = "project-a";
let query = "";
let prefill = "Initial draft";
let configured = true;
function Probe() {
  const observed = useAgentChatRoute({
    projectId,
    chapterId,
    query,
    prefill,
    workbenchMode: "story",
    configured,
    send,
    restore,
  });
  useLayoutEffect(() => {
    hook = observed;
  }, [observed]);
  return null;
}
async function render(strict = false) {
  root ??= createRoot(document.createElement("div"));
  await act(async () =>
    root!.render(
      strict ? createElement(StrictMode, null, createElement(Probe)) : createElement(Probe)
    )
  );
}
beforeEach(() => {
  send.mockResolvedValue(true);
  restore.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  auth.token = "alice";
  auth.enabled = true;
  chapterId = "chapter-a";
  projectId = "project-a";
  query = "";
  prefill = "Initial draft";
  configured = true;
  vi.resetAllMocks();
});
it("restores on credential changes, clears private drafts and rejects retained edits", async () => {
  await render();
  const oldEdit = hook.setDraft;
  const previousReset = hook.scrollResetKey;
  await act(async () => hook.setDraft("Private text"));
  auth.token = "bob";
  await render();
  expect(hook.draft).toBe("");
  expect(restore).toHaveBeenCalledTimes(2);
  expect(hook.scrollResetKey).not.toBe(previousReset);
  await act(async () => oldEdit("Old edit"));
  expect(hook.draft).toBe("");
});
it("consumes an initial query once without resending it on chapter or account changes", async () => {
  query = "Generate story";
  await render();
  await render();
  expect(send).toHaveBeenCalledTimes(1);
  chapterId = "chapter-b";
  await render();
  expect(hook.draft).toBe("");
  auth.token = "bob";
  await render();
  expect(send).toHaveBeenCalledTimes(1);
  expect(restore).toHaveBeenCalledTimes(2);
  query = "Another request";
  await render();
  expect(send).toHaveBeenCalledTimes(2);
});
it("does not duplicate query admission under StrictMode effect replay", async () => {
  query = "Generate story";
  await render(true);
  expect(send).toHaveBeenCalledTimes(1);
  expect(restore).not.toHaveBeenCalled();
});
it("waits for chapter admission and consumes the query only after recovery", async () => {
  configured = false;
  query = "Generate story";
  await render();
  expect(send).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
  configured = true;
  await render();
  expect(send).toHaveBeenCalledTimes(1);
  configured = false;
  await render();
  configured = true;
  await render();
  expect(send).toHaveBeenCalledTimes(1);
  expect(restore).toHaveBeenCalledTimes(1);
});
it("preserves prefill while the default chapter resolves", async () => {
  configured = false;
  chapterId = "";
  await render();
  chapterId = "chapter-a";
  configured = true;
  await render();
  expect(hook.draft).toBe("Initial draft");
  expect(send).not.toHaveBeenCalled();
});
it("preserves an unsent draft through chapter recovery but clears it for a different chapter", async () => {
  await render();
  await act(async () => hook.setDraft("Unsent chapter draft"));
  chapterId = "";
  configured = false;
  await render();
  expect(hook.draft).toBe("Unsent chapter draft");
  chapterId = "chapter-a";
  configured = true;
  await render();
  expect(hook.draft).toBe("Unsent chapter draft");
  chapterId = "";
  configured = false;
  await render();
  chapterId = "chapter-b";
  configured = true;
  await render();
  expect(hook.draft).toBe("");
});
it("does not carry a pending chapter draft across an account change", async () => {
  configured = false;
  chapterId = "";
  await render();
  auth.token = "bob";
  chapterId = "chapter-a";
  configured = true;
  await render();
  expect(hook.draft).toBe("");
});
it("keeps a failed initial query editable without overwriting newer text", async () => {
  query = "Failed query";
  prefill = "";
  send.mockResolvedValueOnce(false);
  await render();
  expect(hook.draft).toBe("Failed query");
  let resolve!: (accepted: boolean) => void;
  send.mockReturnValueOnce(
    new Promise<boolean>((done) => {
      resolve = done;
    })
  );
  query = "Next query";
  await render();
  await act(async () => hook.setDraft("New text"));
  await act(async () => resolve(false));
  expect(hook.draft).toBe("New text");
});
it("uses a new destination's prefill without clearing it when the route param is removed", async () => {
  await render();
  await act(async () => hook.setDraft("Old project draft"));
  projectId = "project-b";
  prefill = "New destination";
  await render();
  expect(hook.draft).toBe("New destination");
  prefill = "";
  await render();
  expect(hook.draft).toBe("New destination");
});

it("preserves typed text when suggestions change or are removed", async () => {
  await render(true);
  await act(async () => hook.setDraft("My unfinished scene"));
  prefill = "Suggested scene";
  await render(true);
  expect(hook.draft).toBe("My unfinished scene");
  prefill = "";
  await render(true);
  expect(hook.draft).toBe("My unfinished scene");
  expect(send).not.toHaveBeenCalled();
});

it("fills a blank composer but does not replay a consumed suggestion after clearing", async () => {
  await render();
  await act(async () => hook.setDraft(" \n "));
  prefill = "Suggested scene";
  await render();
  expect(hook.draft).toBe("Suggested scene");
  await act(async () => hook.setDraft(""));
  await render();
  expect(hook.draft).toBe("");
});

it("restores a chapter's draft ahead of a new suggestion, while a new chapter can accept one", async () => {
  await render();
  await act(async () => hook.setDraft("Unfinished A"));
  chapterId = "chapter-b";
  prefill = "Suggestion B";
  await render();
  expect(hook.draft).toBe("Suggestion B");
  chapterId = "chapter-a";
  prefill = "Suggestion A";
  await render();
  expect(hook.draft).toBe("Unfinished A");
  chapterId = "chapter-b";
  await render();
  expect(hook.draft).toBe("Suggestion B");
});

it("clears private text when credentials and a suggestion change together", async () => {
  await render();
  await act(async () => hook.setDraft("Private text"));
  auth.token = "bob";
  prefill = "Old account suggestion";
  await render();
  expect(hook.draft).toBe("");
});
it("waits for authentication before the first query and does not replay it on relogin", async () => {
  auth.enabled = false;
  query = "Generate story";
  await render();
  expect(send).not.toHaveBeenCalled();
  auth.enabled = true;
  await render();
  expect(send).toHaveBeenCalledTimes(1);
  auth.enabled = false;
  await render();
  auth.enabled = true;
  await render();
  expect(send).toHaveBeenCalledTimes(1);
  expect(restore).toHaveBeenCalledTimes(1);
});

it("restores separate unsent drafts when returning to a chapter", async () => {
  await render();
  await act(async () => hook.setDraft("Chapter A draft"));
  chapterId = "chapter-b";
  await render();
  expect(hook.draft).toBe("");
  await act(async () => hook.setDraft("Chapter B draft"));
  chapterId = "chapter-a";
  await render();
  expect(hook.draft).toBe("Chapter A draft");
  chapterId = "chapter-b";
  await render();
  expect(hook.draft).toBe("Chapter B draft");
});
it("preserves chapter drafts across temporary resolution failures without leaking them to another account", async () => {
  await render();
  await act(async () => hook.setDraft("Private A"));
  chapterId = "";
  configured = false;
  await render();
  chapterId = "chapter-b";
  configured = true;
  await render();
  await act(async () => hook.setDraft("Private B"));
  auth.token = "bob";
  await render();
  chapterId = "chapter-a";
  await render();
  expect(hook.draft).toBe("");
  auth.token = "alice";
  await render();
  expect(hook.draft).toBe("");
});
it("keeps sent drafts empty on return and rejects an old chapter's edit callback", async () => {
  await render();
  const editA = hook.setDraft;
  await act(async () => hook.setDraft("Draft A"));
  await act(async () => hook.setDraft(""));
  chapterId = "chapter-b";
  await render();
  await act(async () => editA("Late A"));
  chapterId = "chapter-a";
  await render();
  expect(hook.draft).toBe("");
});
it("clears the chapter cache when leaving the project", async () => {
  await render();
  await act(async () => hook.setDraft("Project A text"));
  chapterId = "chapter-b";
  await render();
  projectId = "project-b";
  await render();
  projectId = "project-a";
  chapterId = "chapter-a";
  await render();
  expect(hook.draft).toBe("");
});
