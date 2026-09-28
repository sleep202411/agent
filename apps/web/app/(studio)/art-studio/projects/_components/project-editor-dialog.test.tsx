import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({
  user: "a",
  post: vi.fn(),
  upload: vi.fn(),
  dict: vi.fn(),
  toast: vi.fn(),
  saved: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("@/src/lib/api", () => ({ backendApi: { post: s.post } }));
vi.mock("@/src/lib/project-dictionaries", () => ({ fetchProjectDictionaries: s.dict }));
vi.mock("@/src/lib/uploads/workspace-upload", () => ({
  buildOssUrl: (p: string) => p,
  uploadWorkspaceFile: s.upload,
}));
const translate = (key: string) => key;
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => translate }));
vi.mock("sonner", () => ({ toast: { success: s.toast, error: s.toast } }));
import { ProjectEditorDialog } from "./project-editor-dialog";
import type { ProjectOptionItem } from "@/src/types/workspace";
let root: Root;
let node: HTMLDivElement;
const project = {
  id: "p",
  name: "Original",
  description: "Description",
  type: 1,
  episode: 1,
  chapterLength: 5,
  stylePainting: "style",
  aspectRatioType: "wide",
} as ProjectOptionItem;
async function render(open = true, name = "Original", overrides: Partial<ProjectOptionItem> = {}) {
  await act(async () =>
    root.render(
      <ProjectEditorDialog
        open={open}
        worldId="w"
        project={{ ...project, name, ...overrides }}
        onSaved={s.saved}
        onOpenChange={s.close}
      />
    )
  );
}
async function submit() {
  await act(async () => {
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function rename() {
  const input = document.querySelector<HTMLInputElement>('input:not([type="file"])')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Manual"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  for (const v of Object.values(s)) if (typeof v === "function") v.mockReset();
  s.dict.mockResolvedValue({
    typeOptions: [{ value: 1, label: "Type" }],
    sizeOptions: [{ value: "wide", label: "Wide" }],
    styleOptions: [{ id: "style", info: "Style" }],
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
});
it("prevents duplicate saves and suppresses abandoned completion", async () => {
  let resolve!: (v: object) => void;
  s.post.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await submit();
  expect(s.post).toHaveBeenCalledTimes(1);
  const signal = s.post.mock.calls[0][1].signal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({}));
  expect(s.saved).not.toHaveBeenCalled();
  expect(s.close).not.toHaveBeenCalled();
  expect(s.toast).not.toHaveBeenCalled();
});
it("preserves manual drafts on same-project refresh and after failed saves", async () => {
  s.post.mockRejectedValueOnce(new Error("Conflict")).mockResolvedValue({});
  await render();
  await rename();
  await render(true, "Refreshed");
  expect(document.querySelector<HTMLInputElement>('input:not([type="file"])')?.value).toBe(
    "Manual"
  );
  await submit();
  expect(s.toast).toHaveBeenCalledWith("projectUpdateFailed");
  expect(s.close).not.toHaveBeenCalled();
  await submit();
  expect(s.post).toHaveBeenCalledTimes(2);
  expect(s.saved).toHaveBeenCalledTimes(1);
});
it("cancels duplicate cover upload attempts after close", async () => {
  let resolve!: (v: object) => void;
  s.upload.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    value: [new File(["image"], "image.png", { type: "image/png" })],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(s.upload).toHaveBeenCalledTimes(1);
  const signal = s.upload.mock.calls[0][1].signal;
  await render(false);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ path: "old.png" }));
  expect(s.toast).not.toHaveBeenCalled();
});

it("blocks incomplete configuration and recovers on reopening", async () => {
  s.dict.mockRejectedValueOnce(new Error("Configuration unavailable"));
  await render();
  expect(s.toast).toHaveBeenCalledWith("loadConfigFailed");
  await submit();
  expect(s.post).not.toHaveBeenCalled();
  await render(false);
  await render();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector<HTMLInputElement>('input:not([type="file"])')?.value).toBe(
    "Original"
  );
  await submit();
  expect(s.post).toHaveBeenCalledTimes(1);
});
it("cancels abandoned configuration reads and ignores late failures", async () => {
  let reject!: (error: Error) => void;
  s.dict.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      })
  );
  await render();
  const signal = s.dict.mock.calls[0][0] as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => reject(new Error("Old configuration")));
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(s.toast).not.toHaveBeenCalled();
});

it.each([
  { episode: Number.NaN },
  { episode: Number.POSITIVE_INFINITY },
  { episode: 1.5 },
  { episode: Number.MAX_SAFE_INTEGER + 1 },
  { chapterLength: Number.NaN },
  { chapterLength: 1.5 },
  { type: 999 },
  { aspectRatioType: "removed" },
  { stylePainting: "removed" },
])("rejects invalid numeric or obsolete configuration prefills: %j", async (overrides) => {
  await render(true, "Original", overrides as Partial<ProjectOptionItem>);
  await submit();
  expect(s.post).not.toHaveBeenCalled();
});
it("passes the cover's image-only admission rule to the upload service", async () => {
  s.upload.mockRejectedValueOnce(new Error("unsupportedFileType"));
  await render();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    value: [new File(["data"], "report.pdf", { type: "application/pdf" })],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(s.upload.mock.calls[0][1].accept).toBe("image/*");
  expect(s.toast).toHaveBeenCalledWith("unsupportedFileType");
  expect(s.saved).not.toHaveBeenCalled();
});
