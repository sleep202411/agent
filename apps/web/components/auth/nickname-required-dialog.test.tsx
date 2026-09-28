import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NicknameRequiredDialog } from "./nickname-required-dialog";

const state = vi.hoisted(() => ({
  user: { id: 1, nickName: "" } as { id: number; nickName: string } | undefined,
  save: vi.fn(),
  upload: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUserInfo: () => ({ data: state.user, isFetched: true }),
}));
vi.mock("@/src/services/user", () => ({
  updateUserInfo: (...args: unknown[]) => state.save(...args),
  uploadAvatar: (...args: unknown[]) => state.upload(...args),
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let root: Root;
let node: HTMLDivElement;
let client: QueryClient;
async function renderGate() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NicknameRequiredDialog />
      </QueryClientProvider>
    )
  );
}
async function flush() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}
function input(placeholder: string) {
  return node.querySelector<HTMLInputElement>(`[placeholder="${placeholder}"]`)!;
}
function button(name: string) {
  return [...node.querySelectorAll("button")].find(
    (b) => b.textContent === name || b.getAttribute("aria-label") === name
  )!;
}
function change(placeholder: string, value: string) {
  const el = input(placeholder);
  const proto =
    el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.user = { id: 1, nickName: "" };
  state.save.mockResolvedValue(undefined);
  state.upload.mockResolvedValue(undefined);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  node.remove();
  vi.useRealTimers();
});
it("clears both drafts when another account also needs a nickname", async () => {
  await renderGate();
  change("nicknamePlaceholder", "First account");
  change("descriptionPlaceholder", "Private draft");
  state.user = { id: 2, nickName: "" };
  await renderGate();
  expect(input("nicknamePlaceholder").value).toBe("");
  expect(input("descriptionPlaceholder").value).toBe("");
  expect(button("save").disabled).toBe(true);
});
it("locks draft and avatar controls while saving and allows retry after failure", async () => {
  const job = deferred();
  state.save.mockReturnValue(job.promise);
  await renderGate();
  change("nicknamePlaceholder", "Name");
  act(() => button("save").click());
  await flush();
  expect(input("nicknamePlaceholder").disabled).toBe(true);
  expect(input("descriptionPlaceholder").disabled).toBe(true);
  expect(button("avatarUpload").disabled).toBe(true);
  await act(async () => job.reject(new Error("Save rejected")));
  await flush();
  expect(state.error).toHaveBeenCalledWith("Save rejected");
  expect(button("save").disabled).toBe(false);
  state.save.mockResolvedValue(undefined);
  act(() => button("save").click());
  await flush();
  expect(state.save).toHaveBeenCalledTimes(2);
});
it("suppresses an old account's late avatar error", async () => {
  const job = deferred();
  state.upload.mockReturnValue(job.promise);
  await renderGate();
  const fileInput = node.querySelector('input[type="file"]')!;
  Object.defineProperty(fileInput, "files", {
    value: [new File(["x"], "avatar.png", { type: "image/png" })],
  });
  await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
  await flush();
  expect(state.upload).toHaveBeenCalledTimes(1);
  state.user = { id: 2, nickName: "" };
  await renderGate();
  await act(async () => job.reject(new Error("Old upload failed")));
  await flush();
  expect(state.error).not.toHaveBeenCalled();
});
it("preserves a draft through a same-account avatar refresh", async () => {
  await renderGate();
  change("nicknamePlaceholder", "Keep name");
  state.user = { id: 1, nickName: "" };
  await renderGate();
  expect(input("nicknamePlaceholder").value).toBe("Keep name");
});
it("admits only one save before the pending state renders", async () => {
  const job = deferred();
  state.save.mockReturnValue(job.promise);
  await renderGate();
  change("nicknamePlaceholder", "Name");
  act(() => {
    button("save").click();
    button("save").click();
  });
  await flush();
  expect(state.save).toHaveBeenCalledTimes(1);
  await act(async () => job.resolve());
  await flush();
  expect(state.success).toHaveBeenCalledTimes(1);
});
it("does not keep a departed account's save pending or show its success", async () => {
  const job = deferred();
  state.save.mockReturnValue(job.promise);
  await renderGate();
  change("nicknamePlaceholder", "First");
  act(() => button("save").click());
  await flush();
  state.user = { id: 2, nickName: "" };
  await renderGate();
  change("nicknamePlaceholder", "Second");
  expect(button("save").disabled).toBe(false);
  await act(async () => job.resolve());
  await flush();
  expect(state.success).not.toHaveBeenCalled();
  expect(input("nicknamePlaceholder").value).toBe("Second");
});
