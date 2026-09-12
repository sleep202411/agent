import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CrewTaskDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { TaskReviewForm } from "./task-review-form";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  account: "alice",
  review: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useReviewCrewTask: () => ({ mutateAsync: state.review, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
const container = document.createElement("div");
document.body.appendChild(container);
let root = createRoot(container);
const onReviewed = vi.fn();
async function render(id = "task", crewId = "crew") {
  await act(async () =>
    root.render(
      <TaskReviewForm
        task={
          {
            id,
            crewId,
            status: "submitted",
            revisionLimit: 2,
            revisionRoundsUsed: 0,
          } as CrewTaskDTO
        }
        onReviewed={onReviewed}
      />
    )
  );
}
function button(text: string) {
  return Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text)!;
}
async function note(text: string) {
  await act(async () => {
    const field = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.clearAllMocks();
  state.account = "alice";
});
it("serializes approve and revision requests and retains notes for retry", async () => {
  const pending = deferred();
  state.review.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
  await render();
  await note("Please fix timing");
  await act(async () => {
    button("requestRevision").click();
    button("approve").click();
  });
  expect(state.review).toHaveBeenCalledTimes(1);
  expect(container.querySelector("textarea")!.disabled).toBe(true);
  await act(async () => pending.reject(new Error("Review unavailable")));
  expect(container.querySelector("textarea")!.value).toBe("Please fix timing");
  expect(state.error).toHaveBeenCalledWith("Review unavailable");
  await act(async () => button("requestRevision").click());
  expect(onReviewed).toHaveBeenCalledWith("request_revision");
});
it.each(["account", "task", "crew", "close"])(
  "ignores review success after %s changes",
  async (change) => {
    const pending = deferred();
    state.review.mockReturnValue(pending.promise);
    await render();
    await note("original");
    await act(async () => button("approve").click());
    if (change === "account") state.account = "bob";
    if (change === "close") await act(async () => root.render(null));
    else {
      await render(change === "task" ? "other" : "task", change === "crew" ? "other" : "crew");
      expect(container.querySelector("textarea")!.value).toBe("");
      await note("new draft");
    }
    await act(async () => pending.resolve());
    expect(onReviewed).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    if (change !== "close") expect(container.querySelector("textarea")!.value).toBe("new draft");
  }
);
it("suppresses review errors after closing", async () => {
  const pending = deferred();
  state.review.mockReturnValue(pending.promise);
  await render();
  await act(async () => button("approve").click());
  await act(async () => root.render(null));
  await act(async () => pending.reject(new Error("old")));
  expect(state.error).not.toHaveBeenCalled();
});
