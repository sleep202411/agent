import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CrewTaskDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { TaskReviewForm } from "./task-review-form";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  account: "alice",
  dueAt: null as string | null,
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
async function render(id = "task", crewId = "crew", submissionId = "submission-1") {
  await act(async () =>
    root.render(
      <TaskReviewForm
        task={
          {
            id,
            crewId,
            status: "submitted",
            dueAt: state.dueAt,
            submissions: [{ id: submissionId }],
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
  state.dueAt = null;
  vi.useRealTimers();
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
it.each(["account", "task", "crew", "submission", "close"])(
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
      await render(
        change === "task" ? "other" : "task",
        change === "crew" ? "other" : "crew",
        change === "submission" ? "submission-2" : "submission-1"
      );
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

it("sends the identity of the displayed submission and resets notes for a new submission", async () => {
  state.review.mockResolvedValue(undefined);
  await render();
  await note("Version 1 approved");
  await act(async () => button("approve").click());
  expect(state.review).toHaveBeenCalledWith({
    taskId: "task",
    expectedSubmissionId: "submission-1",
    decision: "approve",
    note: "Version 1 approved",
  });
  await note("Old draft");
  await render("task", "crew", "submission-2");
  expect(container.querySelector("textarea")!.value).toBe("");
});

async function deadline(value: string) {
  await act(async () => {
    const input = container.querySelector('input[type="datetime-local"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("converts the explicitly labelled local revision time to an absolute timestamp", async () => {
  state.review.mockResolvedValue(undefined);
  await render();
  await note("Extend the revision");
  await deadline("2099-05-02T10:30");
  expect(container.textContent).toContain("revisionDeadlineLabel");
  await act(async () => button("requestRevision").click());
  expect(state.review).toHaveBeenCalledWith(
    expect.objectContaining({
      decision: "request_revision",
      revisionDueAt: new Date("2099-05-02T10:30").toISOString(),
    })
  );
  expect(container.querySelector("input")!.value).toBe("");
});
it.each(["2000-01-01T10:30", "2099-05-01T10:30", "2099-05-02T10:30"])(
  "rejects past, earlier or equal deadline %s",
  async (value) => {
    state.dueAt = new Date("2099-05-02T10:30").toISOString();
    await render();
    await note("Revise");
    await deadline(value);
    await act(async () => button("requestRevision").click());
    expect(state.review).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith("revisionDeadlineInvalid");
  }
);
it("omits the deadline when blank and when approving even if it is invalid", async () => {
  state.review.mockResolvedValue(undefined);
  await render();
  await note("Revise");
  await act(async () => button("requestRevision").click());
  expect(state.review.mock.calls[0][0]).not.toHaveProperty("revisionDueAt");
  await deadline("2000-01-01T10:30");
  await act(async () => button("approve").click());
  expect(state.review.mock.calls[1][0]).not.toHaveProperty("revisionDueAt");
});
it("rechecks a deadline changed while the form was open", async () => {
  await render();
  await note("Revise");
  await deadline("2099-05-02T10:30");
  state.dueAt = new Date("2099-05-03T10:30").toISOString();
  await render();
  await act(async () => button("requestRevision").click());
  expect(state.review).not.toHaveBeenCalled();
});
it("rechecks expiry at submission time", async () => {
  await render();
  await note("Revise");
  await deadline("2099-05-02T10:30");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2099-05-02T10:31"));
  await act(async () => button("requestRevision").click());
  expect(state.review).not.toHaveBeenCalled();
});
it("retains the deadline after failure but clears it for a different submission", async () => {
  state.review.mockRejectedValueOnce(new Error("Failed"));
  await render();
  await note("Revise");
  await deadline("2099-05-02T10:30");
  await act(async () => button("requestRevision").click());
  expect(container.querySelector("input")!.value).toBe("2099-05-02T10:30");
  await render("task", "crew", "submission-2");
  expect(container.querySelector("input")!.value).toBe("");
});
