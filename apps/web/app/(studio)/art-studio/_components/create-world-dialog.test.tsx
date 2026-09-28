import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreateWorldDialog } from "./create-world-dialog";
const s = vi.hoisted(() => ({
  user: "a",
  upload: vi.fn(),
  analyze: vi.fn(),
  post: vi.fn(),
  toast: vi.fn(),
  close: vi.fn(),
  push: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: s.push }) }));
vi.mock("sonner", () => ({ toast: { success: s.toast, error: s.toast } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: s.invalidate }),
}));
vi.mock("@/src/hooks/use-worlds", () => ({ worldKeys: { all: ["worlds"] } }));
vi.mock("@/src/lib/api", () => ({ backendApi: { post: s.post } }));
vi.mock("@/src/lib/uploads/workspace-upload", () => ({ uploadWorkspaceFile: s.upload }));
vi.mock("@/app/(site)/ips/_hooks/use-spark", () => ({
  useSparkAnalyze: () => ({ mutateAsync: s.analyze }),
}));
let root: Root;
let node: HTMLDivElement;
async function render(open = true) {
  await act(async () => root.render(<CreateWorldDialog open={open} onOpenChange={s.close} />));
}
async function upload() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["brief"], "brief.txt")],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function name(value: string) {
  const input = document.querySelector<HTMLInputElement>('input:not([type="file"])')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function submit() {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent?.includes("createWorldSubmit")
  )!;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  for (const value of Object.values(s)) if (typeof value === "function") value.mockReset();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
});
it("guards uploads and rejects late upload results after account replacement", async () => {
  let resolve!: (v: object) => void;
  s.upload.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await upload();
  expect(s.upload).toHaveBeenCalledTimes(1);
  const signal = s.upload.mock.calls[0][1].signal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ name: "old" }));
  expect(s.analyze).not.toHaveBeenCalled();
  expect(s.toast).not.toHaveBeenCalled();
});
it("retains manual edits while analysis completes", async () => {
  s.upload.mockResolvedValue({ name: "brief.txt" });
  let resolve!: (v: object) => void;
  s.analyze.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await upload();
  await name("Manual");
  await act(async () => resolve({ name: "AI", description: "Summary" }));
  expect(document.querySelector<HTMLInputElement>('input:not([type="file"])')?.value).toBe(
    "Manual"
  );
  expect(document.querySelector("textarea")?.value).toBe("Summary");
});
it("cancels analysis on close without contaminating reopened drafts", async () => {
  s.upload.mockResolvedValue({ name: "brief.txt" });
  let resolve!: (v: object) => void;
  s.analyze.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await upload();
  const signal = s.analyze.mock.calls[0][0].signal;
  await render(false);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ name: "Old" }));
  await render();
  expect(document.querySelector<HTMLInputElement>('input:not([type="file"])')?.value).toBe("");
});

it("guards duplicate creation and suppresses late navigation after closing", async () => {
  let resolve!: (v: object) => void;
  s.post.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await name("World");
  await act(async () => {
    submit().click();
    submit().click();
  });
  expect(s.post).toHaveBeenCalledTimes(1);
  const signal = s.post.mock.calls[0][1].signal;
  await render(false);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ worldId: "w", projectId: "p" }));
  expect(s.push).not.toHaveBeenCalled();
  expect(s.toast).not.toHaveBeenCalled();
  expect(s.close).not.toHaveBeenCalled();
});
it("retains failed creation drafts and permits retry", async () => {
  s.post.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue({});
  await render();
  await name("Retry world");
  await act(async () => submit().click());
  expect(s.toast).toHaveBeenCalledWith("Unavailable");
  expect(document.querySelector<HTMLInputElement>('input:not([type="file"])')?.value).toBe(
    "Retry world"
  );
  await act(async () => submit().click());
  expect(s.post).toHaveBeenCalledTimes(2);
  expect(s.close).toHaveBeenCalledWith(false);
});
it("suppresses completion if account changes during refresh", async () => {
  s.post.mockResolvedValue({ worldId: "w", projectId: "p" });
  let resolve!: () => void;
  s.invalidate.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await render();
  await name("World");
  await act(async () => submit().click());
  s.user = "b";
  await render();
  await act(async () => resolve());
  expect(s.push).not.toHaveBeenCalled();
  expect(s.toast).not.toHaveBeenCalled();
  expect(s.close).not.toHaveBeenCalled();
});
