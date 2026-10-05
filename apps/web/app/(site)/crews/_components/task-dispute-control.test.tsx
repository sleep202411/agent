import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskDisputeControl } from "./task-dispute-control";
import { CrewApiError } from "../_hooks/api";
import type { CrewTaskDTO } from "../_hooks/types";
const h = vi.hoisted(() => ({
  user: "creator" as string | null,
  post: vi.fn(),
  refetch: vi.fn(),
  crew: {
    data: { id: "crew", ownerUserId: "owner" },
    isSuccess: true,
    isError: false,
    isPending: false,
    isFetching: false,
    error: new Error("Denied"),
  },
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.user ? { id: h.user } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_hooks/use-crew-detail", () => ({
  useCrewDetail: () => ({ ...h.crew, refetch: h.refetch }),
}));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<typeof import("../_hooks/api")>()),
  crewApi: { post: (...args: unknown[]) => h.post(...args) },
}));
const task = {
  id: "task",
  crewId: "crew",
  createdByUserId: "creator",
  approvedByUserId: "approver",
  assignees: [{ userId: "assignee" }],
  submissions: [
    {
      id: "submission",
      versionNumber: 1,
      submittedByUserId: "former",
      reviewedByUserId: "reviewer",
    },
  ],
} as unknown as CrewTaskDTO;
let currentTask = task,
  root: Root,
  host: HTMLDivElement,
  qc: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  h.user = "creator";
  currentTask = task;
  h.crew = {
    data: { id: "crew", ownerUserId: "owner" },
    isSuccess: true,
    isError: false,
    isPending: false,
    isFetching: false,
    error: new Error("Denied"),
  };
  vi.clearAllMocks();
  h.post.mockReset().mockResolvedValue({ id: "case-a" });
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
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <TaskDisputeControl task={currentTask} />
      </QueryClientProvider>
    )
  );
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
}
async function click(label: string) {
  expect(button(label)).toBeDefined();
  await act(async () => button(label).click());
}
async function field(selector: string, value: string) {
  await act(async () => {
    const el = host.querySelector(selector)!;
    const proto =
      el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(value: string, index = 0) {
  await act(async () =>
    host.querySelectorAll<HTMLButtonElement>('[role="combobox"]')[index]!.click()
  );
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (o) => o.textContent === value
  );
  expect(option).toBeDefined();
  await act(async () => option!.click());
}
async function prepare() {
  await render();
  await click("title");
  await choose("reviewer");
  await choose("categories.payment", 1);
  await field("input:not([type=hidden])", "Delivery disagreement");
  await field("textarea", "Please review the submission");
}
it("limits respondent choices to actual participants and excludes the caller", async () => {
  await render();
  await click("title");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
  const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  expect(options).toEqual(["choose", "approver", "owner", "assignee", "former", "reviewer"]);
});
it("opens a case with explicit participant, title, message and selected submission evidence", async () => {
  await prepare();
  await act(async () => host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  await click("submit");
  expect(h.post).toHaveBeenCalledWith("/crew-tasks/task/disputes", {
    body: {
      id: expect.any(String),
      respondentUserId: "reviewer",
      title: "Delivery disagreement",
      category: "payment",
      message: "Please review the submission",
      submissionIds: ["submission"],
    },
  });
  expect(host.querySelector('a[href="/en-US/resolution-center/case-a"]')).not.toBeNull();
  expect(host.querySelector("textarea")).toBeNull();
});
it.each(["owner", "assignee", "former", "reviewer", "approver"])(
  "allows recorded participant %s",
  async (user) => {
    h.user = user;
    await render();
    await click("title");
    expect(host.querySelector('[role="combobox"]')).not.toBeNull();
  }
);
it.each(["outsider", null])("blocks unrelated/anonymous viewer %s", async (user) => {
  h.user = user;
  await render();
  if (user) await click("title");
  expect(host.querySelector("textarea")).toBeNull();
  expect(h.post).not.toHaveBeenCalled();
});
it("blocks missing required fields and uses text length boundaries", async () => {
  await render();
  await click("title");
  expect(button("submit").disabled).toBe(true);
  await choose("owner");
  await field("input:not([type=hidden])", "  ");
  await field("textarea", "Message");
  expect(button("submit").disabled).toBe(true);
  await field("input:not([type=hidden])", "x".repeat(181));
  expect(button("submit").disabled).toBe(true);
  await field("input:not([type=hidden])", "Title");
  expect(button("submit").disabled).toBe(true);
  await choose("categories.payment", 1);
  expect(button("submit").disabled).toBe(false);
});
it("keeps exact retry through collapse, task changes and failed participant reads", async () => {
  h.post.mockRejectedValueOnce(new Error("Lost response")).mockResolvedValue({ id: "case-a" });
  await prepare();
  await click("submit");
  const first = h.post.mock.calls[0];
  await click("title");
  await click("title");
  h.crew.isError = true;
  h.crew.isSuccess = false;
  currentTask = { ...task, assignees: [], submissions: [] };
  await render();
  expect(host.querySelector("textarea")).toBeNull();
  await click("retryWrite");
  expect(h.post.mock.calls[1]).toEqual(first);
});
it("blocks a removed respondent without silently selecting another", async () => {
  await prepare();
  currentTask = { ...task, submissions: [] };
  await render();
  expect(button("submit").disabled).toBe(true);
  expect(host.textContent).toContain("participantChanged");
  expect(h.post).not.toHaveBeenCalled();
});
it("shows conflicts with an existing-case link and does not auto-submit", async () => {
  h.post.mockRejectedValue(new CrewApiError(409, { message: "A dispute is already open" }));
  await prepare();
  await click("submit");
  expect(host.textContent).toContain("A dispute is already open");
  expect(host.querySelector('a[href="/en-US/resolution-center"]')).not.toBeNull();
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("suppresses duplicate writes and late account-switch updates", async () => {
  let done!: (v: unknown) => void;
  h.post.mockImplementation(
    () =>
      new Promise((r) => {
        done = r;
      })
  );
  await prepare();
  await click("submit");
  await click("submit");
  expect(h.post).toHaveBeenCalledTimes(1);
  h.user = "owner";
  await render();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  await act(async () => done({ id: "case-a" }));
  expect(invalidate).not.toHaveBeenCalled();
  await click("title");
  expect(host.querySelector("textarea")!.value).toBe("");
});
it("clears drafts when switching tasks", async () => {
  await prepare();
  currentTask = { ...task, id: "other-task" };
  await render();
  await click("title");
  expect(host.querySelector("textarea")!.value).toBe("");
  expect(button("submit").disabled).toBe(true);
});
it("hides participant controls on a failed Crew read and offers refresh", async () => {
  h.crew.isError = true;
  h.crew.isSuccess = false;
  await render();
  await click("title");
  expect(host.textContent).toContain("Denied");
  expect(host.querySelector("textarea")).toBeNull();
  await click("refresh");
  expect(h.refetch).toHaveBeenCalledTimes(1);
});
it("caps selected evidence at twenty records", async () => {
  currentTask = {
    ...task,
    submissions: Array.from({ length: 21 }, (_, i) => ({
      ...task.submissions[0],
      id: `submission-${i}`,
      versionNumber: i + 1,
    })),
  };
  await prepare();
  const checks = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
  for (let i = 0; i < 20; i++) await act(async () => checks[i].click());
  expect(checks[20].disabled).toBe(true);
  await click("submit");
  expect(h.post.mock.calls[0][1].body.submissionIds).toHaveLength(20);
});

it("requires clearing unavailable evidence before starting a new request", async () => {
  await prepare();
  await choose("owner");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  currentTask = { ...task, submissions: [] };
  await render();
  expect(button("submit").disabled).toBe(true);
  expect(host.textContent).toContain("evidenceChanged");
  await click("clearEvidence");
  expect(button("submit").disabled).toBe(false);
  await click("submit");
  expect(h.post.mock.calls[0][1].body.submissionIds).toEqual([]);
});

it("records an optional requested outcome without implying an automatic decision", async () => {
  await prepare();
  await choose("resolutions.warning", 2);
  await click("submit");
  expect(h.post.mock.calls[0][1].body).toMatchObject({
    category: "payment",
    desiredResolution: "warning",
  });
});

async function attach(file: File) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("recovers confirmation after collapse and shares only ready initial evidence", async () => {
  const put = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", put);
  let confirms = 0;
  h.post.mockImplementation(async (path: string) => {
    if (path.endsWith("/confirm")) {
      if (++confirms === 1) throw new Error("Confirmation response lost");
      return { id: "attachment" };
    }
    if (path.endsWith("/disputes")) return { id: "case-a" };
    return {
      url: "https://storage.test/put",
      method: "PUT",
      headers: {},
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
  });
  try {
    await prepare();
    await attach(new File(["pdf"], "evidence.pdf", { type: "application/pdf" }));
    expect(button("submit").disabled).toBe(true);
    expect(host.textContent).toContain("Confirmation response lost");
    const firstConfirm = h.post.mock.calls.find(([path]) => path.endsWith("/confirm"))![0];
    await click("title");
    await click("title");
    expect(host.textContent).toContain("evidence.pdf");
    await click("retry");
    expect(put).toHaveBeenCalledTimes(1);
    expect(h.post.mock.calls.filter(([path]) => path === firstConfirm)).toHaveLength(2);
    expect(button("submit").disabled).toBe(false);
    await click("submit");
    const body = h.post.mock.calls.find(([path]) => path.endsWith("/disputes"))![1].body;
    expect(firstConfirm).toContain(
      `/dispute-drafts/${body.id}/attachments/${body.attachmentIds[0]}/confirm`
    );
    expect(body.attachmentIds).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("caps initial evidence at five files and permits removal before submission", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  h.post.mockImplementation(async (path: string) =>
    path.endsWith("/confirm")
      ? {}
      : {
          url: "https://storage.test/put",
          method: "PUT",
          headers: {},
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        }
  );
  try {
    await prepare();
    for (let i = 0; i < 5; i++)
      await attach(new File(["pdf"], `${i}.pdf`, { type: "application/pdf" }));
    expect(host.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);
    await attach(new File(["pdf"], "sixth.pdf", { type: "application/pdf" }));
    expect(h.post).toHaveBeenCalledTimes(10);
    await click("removeEvidence");
    expect(host.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("rejects unsupported initial evidence without making an upload request", async () => {
  await prepare();
  await attach(new File(["script"], "unsafe.html", { type: "text/html" }));
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("fileInvalid");
});

it("uses the reference complaint description limit", async () => {
  await prepare();
  await field("textarea", "x".repeat(1001));
  expect(button("submit").disabled).toBe(true);
  await field("textarea", "x".repeat(1000));
  expect(button("submit").disabled).toBe(false);
});
