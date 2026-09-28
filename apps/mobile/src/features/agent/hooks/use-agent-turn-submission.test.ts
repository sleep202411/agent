import { act, createElement, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAgentTurnSubmission } from "./use-agent-turn-submission";
const auth = vi.hoisted(() => ({ token: "alice" }));
vi.mock("@/auth/use-auth", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { id: "alice" },
    session: { token: { tokenName: "satoken", tokenValue: auth.token } },
  }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const send = vi.fn<() => Promise<boolean>>();
const commit = vi.fn();
let root: Root | undefined;
let submit: () => Promise<void>;
let edit: (text: string) => void;
let text = "";
function Probe() {
  const [draft, setDraft] = useState("My draft");
  const observed = useAgentTurnSubmission({
    identity: "project/chapter",
    draft,
    setDraft,
    send,
    getExtras: () => ({ attachmentIds: ["file"] }),
    commitExtras: commit,
    onStarted: () => {},
  });
  useLayoutEffect(() => {
    submit = observed;
    edit = setDraft;
    text = draft;
  }, [observed, draft]);
  return null;
}
async function render() {
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
}
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  auth.token = "alice";
});
it("retains draft and attachments on failure and consumes them only after acceptance", async () => {
  send.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await render();
  await act(async () => submit());
  expect(text).toBe("My draft");
  expect(commit).not.toHaveBeenCalled();
  await act(async () => submit());
  expect(text).toBe("");
  expect(commit).toHaveBeenCalledWith({ attachmentIds: ["file"] });
});
it("admits one synchronous submission and preserves newer text", async () => {
  const request = deferred();
  send.mockReturnValueOnce(request.promise);
  await render();
  let first!: Promise<void>;
  await act(async () => {
    first = submit();
    void submit();
  });
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => edit("New draft"));
  await act(async () => {
    request.resolve(true);
    await first;
  });
  expect(text).toBe("New draft");
  expect(commit).toHaveBeenCalledTimes(1);
});
it("rejects retained callbacks and preserves replacement pending state after account changes", async () => {
  const old = deferred();
  const next = deferred();
  send.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await render();
  const oldSubmit = submit;
  let first!: Promise<void>;
  await act(async () => {
    first = submit();
  });
  auth.token = "bob";
  await render();
  let second!: Promise<void>;
  await act(async () => {
    await oldSubmit();
    second = submit();
  });
  await act(async () => {
    old.resolve(true);
    await first;
    await submit();
  });
  expect(commit).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(2);
  await act(async () => {
    next.resolve(true);
    await second;
  });
  expect(commit).toHaveBeenCalledTimes(1);
});
it("does not clear drafts or attachments after unmount", async () => {
  const request = deferred();
  send.mockReturnValueOnce(request.promise);
  await render();
  let pending!: Promise<void>;
  await act(async () => {
    pending = submit();
  });
  await act(async () => root!.unmount());
  root = undefined;
  await act(async () => {
    request.resolve(true);
    await pending;
  });
  expect(commit).not.toHaveBeenCalled();
});
