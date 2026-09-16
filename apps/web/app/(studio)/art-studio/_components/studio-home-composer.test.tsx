import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StudioHomeComposer } from "./studio-home-composer";
const s = vi.hoisted(() => ({
  user: "a",
  upload: vi.fn(),
  create: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: s.push }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: s.toast, warning: s.toast } }));
vi.mock("@/src/lib/uploads/workspace-upload", () => ({
  uploadChatAttachment: s.upload,
  CHAT_ATTACHMENT_MAX_SIZE: 25 * 1024 * 1024,
}));
vi.mock("@/src/services/world", () => ({ quickCreateWorldProduct: s.create }));
let root: Root;
let node: HTMLDivElement;
async function render() {
  await act(async () => root.render(<StudioHomeComposer />));
}
async function type() {
  const input = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Prompt"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send() {
  const input = document.querySelector("textarea")!;
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
    );
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  for (const v of Object.values(s)) if (typeof v === "function") v.mockReset();
  sessionStorage.clear();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
});
it("prevents duplicate creation and ignores late account-replaced navigation", async () => {
  let resolve!: (v: object) => void;
  s.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await type();
  await send();
  expect(s.create).toHaveBeenCalledTimes(1);
  const signal = s.create.mock.calls[0][1];
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ worldId: "w", projectId: "p" }));
  expect(s.push).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
  expect(document.querySelector("textarea")?.value).toBe("");
});
it("keeps failed creation retryable", async () => {
  s.create
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue({ worldId: "w", projectId: "p" });
  await render();
  await type();
  await send();
  expect(s.create).toHaveBeenCalledTimes(1);
  expect(document.querySelector("textarea")?.value).toBe("Prompt");
  await send();
  expect(s.create).toHaveBeenCalledTimes(2);
  expect(s.push).toHaveBeenCalledTimes(1);
});
it("cancels duplicate script upload attempts on unmount", async () => {
  let resolve!: (v: object) => void;
  s.upload.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["brief"], "brief.txt")] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(s.upload).toHaveBeenCalledTimes(1);
  const signal = s.upload.mock.calls[0][1].signal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ ref: "old" }));
  expect(s.toast).not.toHaveBeenCalled();
});
