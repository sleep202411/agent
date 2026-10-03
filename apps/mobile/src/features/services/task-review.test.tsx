import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskReview } from "./task-review";
import { useTaskReviewSession } from "./use-task-review-session";
import type { TaskDetail } from "./task-detail-api";
const h = vi.hoisted(() => ({
  permission: vi.fn(),
  review: vi.fn(),
  refresh: vi.fn(),
  generation: 1,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./task-review-api", async (original) => ({
  ...(await original<typeof import("./task-review-api")>()),
  fetchTaskReviewPermission: h.permission,
  reviewTask: h.review,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
  }) => <input value={value} disabled={!editable} onChange={(e) => onChangeText(e.target.value)} />,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const submission = {
  id: "submission",
  versionNumber: 1,
  submittedByUserId: "1",
  note: "",
  professionalDelivery: null,
  canvasVersionId: null,
  productionVersionId: null,
  reviewNote: null,
  reviewedByUserId: null,
  reviewedAt: null,
  mergedAt: null,
  createdAt: "2026-09-29T00:00:00Z",
  assets: [
    {
      id: "video",
      name: "Final.mp4",
      mediaAssetId: "media",
      contentType: "video/mp4",
      sizeBytes: null,
    },
  ],
};
const task: TaskDetail = {
  id: "task",
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "",
  version: 2,
  status: "submitted",
  revisionLimit: 2,
  revisionRoundsUsed: 0,
  priority: "normal" as const,
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  storyboardClipId: "clip",
  workflowState: { name: "Review" },
  startAt: null,
  dueAt: null,
  labels: [],
  assignees: [],
  submissions: [submission],
};
let root: Root, host: HTMLDivElement;
const render = (value = task) =>
  act(async () =>
    root.render(<TaskReview task={value} userId="1" generation={1} onRefresh={h.refresh} />)
  );
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text);
const type = (n: number, text: string) => {
  const input = host.querySelectorAll("input")[n]!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.permission.mockResolvedValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("requires review permission and a submitted task", async () => {
  h.permission.mockResolvedValue(false);
  await render();
  expect(button("taskReview.approve")).toBeUndefined();
  await render({ ...task, status: "approved" });
  expect(host.textContent).toBe("");
});
it("guards duplicate approvals, preserves submission ID and binds the selected video", async () => {
  let finish!: () => void;
  h.review.mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      })
  );
  await render();
  await act(async () => {
    button("taskReview.approve")!.click();
    button("taskReview.approve")!.click();
  });
  expect(h.review).toHaveBeenCalledExactlyOnceWith("task", "crew", {
    expectedSubmissionId: "submission",
    decision: "approve",
    note: "",
    bindAssetNodeId: "video",
  });
  await act(async () => finish());
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("enforces revision notes/limits and validates deadlines before mutation", async () => {
  await render();
  expect(button("taskReview.requestRevision")!.disabled).toBe(true);
  await act(async () => type(0, "Please fix audio"));
  await act(async () => type(1, "bad date"));
  await act(async () => button("taskReview.requestRevision")!.click());
  expect(h.review).not.toHaveBeenCalled();
  expect(host.textContent).toContain("taskReview.revisionDeadlineInvalid");
  await render({ ...task, revisionRoundsUsed: 2 });
  expect(button("taskReview.requestRevision")!.disabled).toBe(true);
  expect(button("taskReview.approve")!.disabled).toBe(false);
});
it("refreshes after uncertain review and ignores foreign-account completion", async () => {
  h.review.mockRejectedValueOnce(new Error("Submission changed"));
  await render();
  await act(async () => button("taskReview.approve")!.click());
  expect(host.textContent).toContain("Submission changed");
  expect(button("taskReview.approve")!.disabled).toBe(true);
  await act(async () => button("thread.refresh")!.click());
  expect(h.refresh).toHaveBeenCalledTimes(1);
});
it("aborts permission loading and suppresses late account results", async () => {
  let finish!: (v: boolean) => void;
  h.permission.mockImplementation(
    () =>
      new Promise<boolean>((r) => {
        finish = r;
      })
  );
  await render();
  const signal = h.permission.mock.calls[0][2];
  h.generation = 2;
  await act(async () => finish(true));
  expect(button("taskReview.approve")).toBeUndefined();
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});

function Journey({ value = task }: { value?: TaskDetail }) {
  const [snapshot, setSnapshot] = useState(value);
  const [refresh, setRefresh] = useState(0);
  const reload = () => {
    setSnapshot({ ...value });
    setRefresh((n) => n + 1);
  };
  const session = useTaskReviewSession(value.id, 1, reload);
  return (
    <>
      <button onClick={reload}>Reload details</button>
      <TaskReview
        key={refresh}
        task={snapshot}
        userId="1"
        generation={1}
        onRefresh={reload}
        session={session}
      />
    </>
  );
}
it("keeps review input across a detail retry after an uncertain response", async () => {
  h.review.mockRejectedValueOnce(new Error("Response interrupted"));
  await act(async () => root.render(<Journey />));
  await act(async () => type(0, "Fix the final audio"));
  await act(async () => type(1, "2099-10-20 12:00"));
  await act(async () => button("taskReview.requestRevision")!.click());
  expect(button("taskReview.approve")!.disabled).toBe(true);
  await act(async () => button("thread.refresh")!.click());
  expect(host.querySelectorAll("input")[0]!.value).toBe("Fix the final audio");
  expect(host.querySelectorAll("input")[1]!.value).toBe("2099-10-20 12:00");
  expect(h.review).toHaveBeenCalledTimes(1);
  expect(button("taskReview.requestRevision")!.disabled).toBe(false);
});
it("keeps an in-flight review locked through an unrelated detail refresh", async () => {
  let finish!: () => void;
  h.review.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => root.render(<Journey />));
  await act(async () => type(0, "Approved audio"));
  await act(async () => button("taskReview.approve")!.click());
  await act(async () => button("Reload details")!.click());
  expect(button("taskReview.approve")!.disabled).toBe(true);
  expect(host.querySelector("input")!.value).toBe("Approved audio");
  await act(async () => button("taskReview.approve")!.click());
  expect(h.review).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(host.querySelector("input")!.value).toBe("");
});
it("does not apply an older submission's note to a new delivery", async () => {
  await render();
  await act(async () => type(0, "Old delivery feedback"));
  await render({ ...task, submissions: [{ ...submission, id: "new-submission" }] });
  expect(host.querySelector("input")!.value).toBe("");
  await act(async () => button("taskReview.approve")!.click());
  expect(h.review.mock.calls[0][2]).toMatchObject({
    expectedSubmissionId: "new-submission",
    note: "",
  });
});
it("retires review input on account generation change", async () => {
  await render();
  await act(async () => type(0, "Private review"));
  h.generation = 2;
  await act(async () =>
    root.render(<TaskReview task={task} userId="2" generation={2} onRefresh={h.refresh} />)
  );
  expect(host.querySelector("input")!.value).toBe("");
});

it("requires another fresh read if an in-flight review fails after a refresh", async () => {
  let fail!: (e: Error) => void;
  h.review.mockImplementation(
    () =>
      new Promise<void>((_, reject) => {
        fail = reject;
      })
  );
  await act(async () => root.render(<Journey />));
  await act(async () => button("taskReview.approve")!.click());
  await act(async () => button("Reload details")!.click());
  await act(async () => fail(new Error("Response lost")));
  expect(button("taskReview.approve")!.disabled).toBe(true);
  await act(async () => button("thread.refresh")!.click());
  expect(button("taskReview.approve")!.disabled).toBe(false);
  expect(h.review).toHaveBeenCalledTimes(1);
});
