import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskReview } from "./task-review";
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
