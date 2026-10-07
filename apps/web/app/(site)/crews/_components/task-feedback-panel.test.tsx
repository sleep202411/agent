import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskFeedbackPanel } from "./task-feedback-panel";
import { CrewApiError } from "../_hooks/api";
const h = vi.hoisted(() => ({
  user: "applicant",
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  ready: vi.fn(),
  updated: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: h.user } }) }));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<typeof import("../_hooks/api")>()),
  crewApi: {
    get: (...args: unknown[]) => h.get(...args),
    post: (...args: unknown[]) => h.post(...args),
    put: (...args: unknown[]) => h.put(...args),
  },
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
const task = {
  id: "task",
  status: "approved",
  submissions: [
    {
      id: "submission",
      versionNumber: 2,
      submittedByUserId: "creator",
      reviewedByUserId: "reviewer",
      reviewedAt: "2026-09-25T10:00:00Z",
    },
  ],
} as unknown as import("../_hooks/types").CrewTaskDTO;
let currentTask = task;
const feedback = {
  id: "feedback",
  taskId: "task",
  submissionId: "submission",
  authorUserId: "reviewer",
  subjectUserId: "creator",
  ratings: { direction: "creator", productionAbility: 4, understanding: 3, communication: 5 },
  comment: "Private evaluation",
  response: null,
  createdAt: "2026-09-25T10:00:00Z",
  respondedAt: null,
};
const page = { items: [] as (typeof feedback)[], nextCursor: null };
let root: Root, host: HTMLDivElement, qc: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  h.user = "creator";
  currentTask = task;
  vi.clearAllMocks();
  h.get.mockReset().mockResolvedValue(page);
  h.post.mockReset().mockResolvedValue({});
  h.put.mockReset().mockResolvedValue({});
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  host.remove();
});
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
async function render(taskScope = true) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <TaskFeedbackPanel task={taskScope ? currentTask : undefined} />
      </QueryClientProvider>
    )
  );
  await flush();
}
async function rate(...values: string[]) {
  const controls = host.querySelectorAll<HTMLButtonElement>('[role="combobox"]');
  for (const [index, value] of values.entries()) {
    await act(async () => controls[index].click());
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent === value
    );
    expect(option).toBeDefined();
    await act(async () => option!.click());
  }
}

function button(key: string) {
  return Array.from(host.querySelectorAll("button")).find((b) => b.textContent === key);
}
async function click(key: string) {
  expect(button(key)).toBeDefined();
  await act(async () => button(key)!.click());
  await flush();
}
async function field(selector: string, value: string) {
  await act(async () => {
    const node = host.querySelector(selector)!;
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("requires explicit scores and includes the actual reviewer’s optional comment", async () => {
  await render();
  expect(host.querySelectorAll('[role="combobox"]')).toHaveLength(1);
  expect(button("submit")?.disabled).toBe(true);
  await field("textarea", "Clear management");
  await rate("4");
  await click("submit");
  expect(h.post).toHaveBeenCalledWith("/crew-tasks/task/feedback", {
    body: {
      subjectUserId: "reviewer",
      publicOnProfile: true,
      ratings: { direction: "manager", managementAbility: 4 },
      comment: "Clear management",
    },
  });
});
it("lets the actual reviewer rate all three creator dimensions", async () => {
  h.user = "reviewer";
  await render();
  expect(host.querySelectorAll('[role="combobox"]')).toHaveLength(3);
  await rate("3", "4", "5");
  await field("textarea", "Good delivery");
  await click("submit");
  expect(h.post.mock.calls[0][1].body).toEqual({
    subjectUserId: "creator",
    publicOnProfile: true,
    ratings: { direction: "creator", productionAbility: 3, understanding: 4, communication: 5 },
    comment: "Good delivery",
  });
});
it.each(["unapproved", "outsider", "missing-review", "self"])(
  "does not compose feedback for %s",
  async (mode) => {
    if (mode === "unapproved") currentTask = { ...task, status: "submitted" };
    if (mode === "outsider") h.user = "manager-not-reviewer";
    if (mode === "missing-review")
      currentTask = { ...task, submissions: [{ ...task.submissions[0]!, reviewedAt: null }] };
    if (mode === "self")
      currentTask = {
        ...task,
        submissions: [{ ...task.submissions[0]!, reviewedByUserId: "creator" }],
      };
    await render();
    expect(button("submit")).toBeUndefined();
  }
);
it("uses the latest submission evidence and clears drafts when it changes", async () => {
  await render();
  await field("textarea", "Old submission draft");
  currentTask = {
    ...task,
    submissions: [
      ...task.submissions,
      { ...task.submissions[0]!, id: "latest", versionNumber: 3, reviewedByUserId: "new-reviewer" },
    ],
  };
  await render();
  expect(host.querySelector("textarea")?.value).toBe("");
  await rate("5");
  await field("textarea", "New review");
  await click("submit");
  expect(h.post.mock.calls[0][1].body.subjectUserId).toBe("new-reviewer");
});
it("shows participant-only personal history and permits a subject response after departure", async () => {
  h.get.mockResolvedValue({
    ...page,
    items: [
      feedback,
      {
        ...feedback,
        id: "foreign",
        authorUserId: "other",
        subjectUserId: "someone",
        comment: "Do not show",
      },
    ],
  });
  await render(false);
  expect(h.get.mock.calls[0][0]).toBe("/me/crew-task-feedback");
  expect(button("appealFeedback")).toBeDefined();
  expect(host.textContent).not.toContain("Do not show");
  expect(button("submit")).toBeUndefined();
  await field("textarea", "Thank you for the feedback");
  await click("respond");
  expect(h.put).toHaveBeenCalledWith("/crew-task-feedback/feedback/response", {
    body: { response: "Thank you for the feedback" },
  });
});
it("does not offer a second response or let authors respond as the subject", async () => {
  h.get.mockResolvedValue({ ...page, items: [{ ...feedback, response: "Recorded response" }] });
  await render(false);
  expect(button("respond")).toBeUndefined();
  h.user = "reviewer";
  h.get.mockResolvedValue({ ...page, items: [feedback] });
  await render(false);
  expect(button("respond")).toBeUndefined();
  expect(button("appealFeedback")).toBeUndefined();
});
it("does not allow editing previously recorded feedback", async () => {
  h.user = "reviewer";
  h.get.mockResolvedValue({ ...page, items: [feedback] });
  await render();
  expect(button("submit")).toBeUndefined();
  expect(host.textContent).toContain("Private evaluation");
});
it("retains the exact feedback through an uncertain response", async () => {
  h.post.mockRejectedValueOnce(new Error("Connection lost"));
  await render();
  await rate("4");
  await field("textarea", "Original");
  await click("submit");
  const first = h.post.mock.calls[0];
  await click("submit");
  expect(h.post).toHaveBeenCalledTimes(1);
  await click("retry");
  expect(h.post.mock.calls[1]).toEqual(first);
});
it("retries an uncertain subject response unchanged", async () => {
  h.get.mockResolvedValue({ ...page, items: [feedback] });
  h.put.mockRejectedValueOnce(new Error("Connection lost"));
  await render(false);
  await field("textarea", "My response");
  await click("respond");
  const first = h.put.mock.calls[0];
  await click("retry");
  expect(h.put.mock.calls[1]).toEqual(first);
});
it("hides cached private feedback after permission loss", async () => {
  h.get.mockResolvedValue({ ...page, items: [feedback] });
  await render(false);
  h.get.mockRejectedValue(new CrewApiError(403, { message: "Denied" }));
  await act(async () => {
    await qc.refetchQueries();
  });
  await flush();
  expect(host.textContent).not.toContain("Private evaluation");
  expect(button("respond")).toBeUndefined();
  expect(button("appealFeedback")).toBeUndefined();
});
it("isolates pending writes across accounts", async () => {
  let finish!: () => void;
  h.post.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await rate("4");
  await field("textarea", "Original account");
  await click("submit");
  await click("submit");
  expect(h.post).toHaveBeenCalledTimes(1);
  h.user = "other";
  await render(false);
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  await act(async () => finish());
  await flush();
  expect(invalidate).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("saved");
});
it("paginates personal history with the returned participant cursor", async () => {
  h.get
    .mockResolvedValueOnce({ items: [feedback], nextCursor: "feedback" })
    .mockResolvedValue({ items: [{ ...feedback, id: "older" }], nextCursor: null });
  await render(false);
  await click("more");
  expect(h.get.mock.calls[1][1].query.cursor).toBe("feedback");
  expect(host.querySelectorAll("article")).toHaveLength(2);
});

it.each(["creator", "reviewer"])("allows %s to submit ratings without a comment", async (user) => {
  h.user = user;
  await render();
  expect(button("submit")?.disabled).toBe(true);
  if (user === "creator") await rate("4");
  else await rate("3", "4", "5");
  expect(button("submit")?.disabled).toBe(false);
  await click("submit");
  expect(h.post).toHaveBeenCalledWith("/crew-tasks/task/feedback", {
    body: expect.objectContaining({
      comment: "",
      subjectUserId: user === "creator" ? "reviewer" : "creator",
    }),
  });
});
