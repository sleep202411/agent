import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CrewTaskDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { SubmitTaskDialog } from "./task-dialogs";

const submit = vi.hoisted(() => vi.fn());
const assetQuery = vi.hoisted(() => ({
  data: { items: [{ id: "asset-1", name: "Output" }] },
  isLoading: false,
  isFetching: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useSubmitCrewTask: () => ({ mutateAsync: submit, isPending: false }),
}));
vi.mock("../../_hooks/use-crew-assets", () => ({ useCrewAssets: () => assetQuery }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
const onSubmitted = vi.fn();
const onOpenChange = vi.fn();
function render(taskId: string, open = true) {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  act(() =>
    root!.render(
      <SubmitTaskDialog
        open={open}
        crewId="crew-1"
        task={{ id: taskId } as CrewTaskDTO}
        onSubmitted={onSubmitted}
        onOpenChange={onOpenChange}
      />
    )
  );
}
function clickSubmit() {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "submit")!.click();
}
function fill(value: string) {
  const input = document.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host?.remove();
  vi.resetAllMocks();
  assetQuery.error = null;
  assetQuery.isLoading = false;
  assetQuery.data = { items: [{ id: "asset-1", name: "Output" }] };
});

it("does not close a new submission dialog when an earlier request completes", async () => {
  let resolve!: (value: unknown) => void;
  submit.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  render("task-1");
  act(clickSubmit);
  render("task-1", false);
  render("task-2");
  act(() => fill("Second task notes"));
  await act(async () => resolve({ id: "task-1" }));
  expect(onSubmitted).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(document.querySelector("textarea")!.value).toBe("Second task notes");
});

it("clears the previous task's notes when the selected task changes", () => {
  render("task-1");
  act(() => fill("Only belongs to task one"));
  render("task-2");
  expect(document.querySelector("textarea")!.value).toBe("");
});

it("submits only once for repeated clicks before the pending render", async () => {
  let resolve!: (value: unknown) => void;
  submit.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  render("task-1");
  act(() => {
    clickSubmit();
    clickSubmit();
  });
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ id: "task-1" }));
  expect(onSubmitted).toHaveBeenCalledWith("task-1");
});

it("retains notes and permits retry after a failed submission", async () => {
  submit
    .mockRejectedValueOnce(new Error("Temporary failure"))
    .mockResolvedValueOnce({ id: "task-1" });
  render("task-1");
  act(() => fill("Keep these notes"));
  await act(async () => clickSubmit());
  expect(document.querySelector("textarea")!.value).toBe("Keep these notes");
  await act(async () => clickSubmit());
  expect(submit).toHaveBeenCalledTimes(2);
  expect(onSubmitted).toHaveBeenCalledTimes(1);
});

it("locks the submitted draft and restores editing after failure", async () => {
  let reject!: (error: Error) => void;
  submit.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  render("task-1");
  act(() => fill("Review this output"));
  act(() => document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  act(clickSubmit);
  expect(document.querySelector("textarea")!.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.disabled).toBe(true);
  expect(submit).toHaveBeenCalledWith({ taskId: "task-1", note: "Review this output", assetNodeIds: ["asset-1"] });
  await act(async () => reject(new Error("Please retry")));
  expect(document.querySelector("textarea")!.disabled).toBe(false);
  expect(document.querySelector("textarea")!.value).toBe("Review this output");
  expect(document.querySelector('[role="checkbox"]')!.getAttribute("aria-checked")).toBe("true");
});

it("distinguishes asset loading from an empty result", () => {
  assetQuery.isLoading = true;
  assetQuery.data = { items: [] };
  render("task-1");
  expect(document.body.textContent).toContain("loading");
  expect(document.body.textContent).not.toContain("noRecentAssets");
});
it("keeps loaded attachments and exposes a failed refresh for retry", async () => {
  assetQuery.error = new Error("Asset service unavailable");
  render("task-1");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Asset service unavailable");
  expect(document.body.textContent).toContain("Output");
  await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "retry")!.click());
  expect(assetQuery.refetch).toHaveBeenCalledTimes(1);
});
