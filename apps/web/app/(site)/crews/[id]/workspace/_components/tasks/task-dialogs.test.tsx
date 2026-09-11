import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CrewTaskDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { SubmitTaskDialog } from "./task-dialogs";

const submit = vi.hoisted(() => vi.fn());
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useSubmitCrewTask: () => ({ mutateAsync: submit, isPending: false }),
}));
vi.mock("../../_hooks/use-crew-assets", () => ({ useCrewAssets: () => ({ data: { items: [] } }) }));
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
