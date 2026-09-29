import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskDetail } from "./task-detail";
const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  active: true,
  generation: 1,
  close: vi.fn(),
  web: vi.fn(),
}));
vi.mock("./task-review", () => ({ TaskReview: () => <div>review</div> }));
vi.mock("./task-delivery", () => ({ TaskDelivery: () => <div>delivery</div> }));
vi.mock("./task-commitments", () => ({ TaskCommitments: () => <div>commitments</div> }));
vi.mock("./task-timeline", () => ({ TaskTimeline: () => <div>timeline</div> }));
vi.mock("./task-detail-api", () => ({ fetchTaskDetail: h.fetch }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("./user-displays", () => ({
  useUserDisplays: () => new Map([["1", { nickname: "Artist" }]]),
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <div>loading</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const detail = {
  number: 7,
  title: "Scene",
  description: "Private brief",
  workflowState: { name: "Review" },
  startAt: null,
  dueAt: null,
  labels: [{ id: "label", name: "Animation" }],
  assignees: [{ userId: "1" }],
};
const render = (taskId = "task") =>
  act(async () =>
    root.render(
      <TaskDetail
        crewId="crew"
        taskId={taskId}
        generation={1}
        userId="1"
        onClose={h.close}
        onOpenWeb={h.web}
      />
    )
  );
const click = (s: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => b.textContent === s)!
    .click();
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.generation = 1;
  h.fetch.mockResolvedValue(detail);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("shows details, resolved assignees, labels and an explicit workspace continuation", async () => {
  await render();
  for (const text of [
    "Scene",
    "Private brief",
    "Review",
    "Artist",
    "Animation",
    "thread.taskUnset",
  ])
    expect(host.textContent).toContain(text);
  await act(async () => click("thread.taskOpenWorkspace"));
  expect(h.web).toHaveBeenCalledTimes(1);
  await act(async () => click("thread.backToChat"));
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("clears details during refresh and keeps revoked access retryable", async () => {
  await render();
  h.fetch.mockRejectedValueOnce(new Error("Conversation not found"));
  await act(async () => click("thread.refresh"));
  expect(host.textContent).not.toContain("Private brief");
  expect(host.textContent).toContain("Conversation not found");
  expect(host.textContent).not.toContain("thread.taskOpenWorkspace");
  await act(async () => click("inbox.retry"));
  expect(host.textContent).toContain("Private brief");
});
it("aborts replaced/backgrounded requests and suppresses late private results", async () => {
  let finish!: (v: unknown) => void;
  h.fetch.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  const signal = h.fetch.mock.calls[0][2];
  await render("other");
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ ...detail, title: "Old secret" }));
  expect(host.textContent).not.toContain("Old secret");
  h.active = false;
  await render("other");
  expect(host.textContent).toBe("");
  h.active = true;
  h.generation = 2;
  await render("other");
  expect(host.textContent).toBe("");
});
