import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SparkDialog } from "./spark-dialog";
const s = vi.hoisted(() => ({
  user: "a",
  analyze: vi.fn(),
  update: vi.fn(),
  toast: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: s.toast, error: s.toast, warning: s.toast } }));
vi.mock("@/app/(site)/ips/_hooks/use-ip", () => ({
  SPARK_MAX_BYTES: 20000000,
  useSparkAnalyze: () => ({ mutateAsync: s.analyze }),
  useUpdateProject: () => ({ mutateAsync: s.update }),
  useIPTagList: () => ({ data: [] }),
}));
vi.mock("@/app/(site)/ips/_hooks/use-ip-list", () => ({ useIPTypes: () => ({ data: [] }) }));
let root: Root;
let node: HTMLDivElement;
async function render(open = true, id = "1") {
  await act(async () =>
    root.render(<SparkDialog open={open} projectId={id} onOpenChange={s.close} />)
  );
}
async function upload(twice = false) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["brief"], "brief.txt")],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (twice) input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function typeName(value: string) {
  const input = document.querySelector<HTMLInputElement>('input:not([type="file"])')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function apply() {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "sparkApply"
  )!;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  for (const fn of [s.analyze, s.update, s.toast, s.close]) fn.mockReset();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
});
it("guards repeated analysis and cancels it on close", async () => {
  let resolve!: (v: unknown) => void;
  s.analyze.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await upload(true);
  expect(s.analyze).toHaveBeenCalledTimes(1);
  const signal = s.analyze.mock.calls[0][0].signal as AbortSignal;
  await render(false);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ name: "Old" }));
  await render();
  expect(document.querySelector<HTMLInputElement>('input:not([type="file"])')?.value).toBe("");
});
it("preserves manual text typed during analysis", async () => {
  let resolve!: (v: unknown) => void;
  s.analyze.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await upload();
  await typeName("Manual title");
  await act(async () => resolve({ name: "AI title", description: "AI description" }));
  expect(document.querySelector<HTMLInputElement>('input:not([type="file"])')?.value).toBe(
    "Manual title"
  );
  expect(document.querySelector("textarea")?.value).toBe("AI description");
});
it("guards repeated apply and suppresses replacement-project callbacks", async () => {
  let resolve!: (v: unknown) => void;
  s.update.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await typeName("Title");
  await act(async () => {
    apply().click();
    apply().click();
  });
  expect(s.update).toHaveBeenCalledTimes(1);
  await render(true, "2");
  await act(async () => resolve({}));
  expect(s.toast).not.toHaveBeenCalled();
  expect(s.close).not.toHaveBeenCalled();
});

it("shows the analysis failure without clearing manually entered text", async () => {
  s.analyze.mockRejectedValue(new Error("HTTP 400 — The uploaded file has no readable text."));
  await render();
  await typeName("Keep this title");
  await upload();
  expect(document.body.textContent).toContain("HTTP 400 — The uploaded file has no readable text.");
  expect(document.querySelector<HTMLInputElement>('input:not([type="file"])')?.value).toBe(
    "Keep this title"
  );
});
