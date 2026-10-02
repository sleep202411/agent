import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApplicationInterviewPanel } from "./application-interview-panel";
import { CrewApiError } from "../_hooks/api";
const h = vi.hoisted(() => ({
  user: "applicant",
  get: vi.fn(),
  post: vi.fn(),
  ready: vi.fn(),
  updated: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: h.user } }) }));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<typeof import("../_hooks/api")>()),
  crewApi: {
    get: (...args: unknown[]) => h.get(...args),
    post: (...args: unknown[]) => h.post(...args),
  },
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
const page = {
  applicationStatus: "pending",
  canUpdate: true,
  version: 2,
  state: "proposed",
  scheduledAt: "2099-09-25T10:00:00Z",
  items: [
    {
      id: "event",
      version: 2,
      actorUserId: "reviewer",
      action: "schedule",
      message: "Private interview plan",
      createdAt: "2026-09-25T10:00:00Z",
      scheduledAt: "2099-09-25T10:00:00Z",
    },
  ],
  nextBeforeVersion: null,
};
let root: Root, host: HTMLDivElement, qc: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "applicant";
  vi.clearAllMocks();
  h.get.mockReset().mockResolvedValue(page);
  h.post.mockReset().mockResolvedValue({});
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
async function render(reviewer = false, conversation = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <ApplicationInterviewPanel
          applicationId="app"
          applicantId="applicant"
          reviewer={reviewer}
          conversation={conversation}
          onReady={h.ready}
          onUpdated={h.updated}
        />
      </QueryClientProvider>
    )
  );
  await flush();
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
async function replacePage(value: typeof page) {
  await act(async () =>
    qc.setQueryData(["crew-application-interview", "app", h.user], {
      pages: [value],
      pageParams: [undefined],
    })
  );
  await flush();
}
it("lets the applicant confirm the exact version without reviewer-only controls", async () => {
  await render();
  expect(button("schedule")).toBeUndefined();
  expect(button("complete")).toBeUndefined();
  expect(h.ready).toHaveBeenLastCalledWith(false);
  await field("textarea", "I can attend");
  await click("confirm");
  const request = h.post.mock.calls[0][1].body;
  expect(request).toMatchObject({ action: "confirm", expectedVersion: 2, message: "I can attend" });
  expect(request.requestKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(request).not.toHaveProperty("scheduledAt");
  expect(h.updated).toHaveBeenCalledTimes(1);
});
it("schedules with an explicit timezone and preserves the draft's original version", async () => {
  h.user = "reviewer";
  await render(true);
  await field("textarea", "Review story outline");
  await field("input", "2099-10-01T10:30");
  await replacePage({ ...page, version: 3 });
  await click("schedule");
  expect(h.post.mock.calls[0][1].body).toMatchObject({
    expectedVersion: 2,
    action: "schedule",
    scheduledAt: new Date("2099-10-01T10:30").toISOString(),
  });
  expect(button("confirm")).toBeUndefined();
});
it("retains the exact request on an ambiguous failure even after status changes", async () => {
  h.post.mockRejectedValueOnce(new Error("Connection lost"));
  await render();
  await field("textarea", "Confirmed");
  await click("confirm");
  const original = h.post.mock.calls[0][1].body;
  expect(host.querySelector("fieldset")!.disabled).toBe(true);
  await replacePage({
    ...page,
    version: 3,
    canUpdate: false,
    applicationStatus: "approved",
    state: "completed",
  });
  expect(h.ready).toHaveBeenLastCalledWith(false);
  await click("retry");
  expect(h.post.mock.calls[1][1].body).toEqual(original);
});
it("surfaces a version rejection and requires explicit draft discard before using the new version", async () => {
  h.post.mockRejectedValueOnce(new CrewApiError(409, { message: "Interview changed" }));
  await render();
  await field("textarea", "Old consent");
  await replacePage({ ...page, version: 3 });
  await click("confirm");
  expect(host.textContent).toContain("Interview changed");
  expect(button("retry")).toBeUndefined();
  await click("discard");
  expect(host.querySelector("textarea")!.value).toBe("");
  await field("textarea", "New consent");
  await click("confirm");
  expect(h.post.mock.calls[0][1].body.expectedVersion).toBe(2);
  expect(h.post.mock.calls[1][1].body.expectedVersion).toBe(3);
});
it("hides previous history and controls after account access fails", async () => {
  await render();
  expect(host.textContent).toContain("Private interview plan");
  h.user = "outsider";
  h.get.mockRejectedValue(new Error("Forbidden"));
  await render();
  expect(host.textContent).not.toContain("Private interview plan");
  expect(button("confirm")).toBeUndefined();
  expect(host.textContent).toContain("Forbidden");
  expect(h.ready).toHaveBeenLastCalledWith(false);
});
it("makes reviewed history read-only and loads older events with a bounded cursor", async () => {
  h.get.mockResolvedValueOnce({
    ...page,
    canUpdate: false,
    state: "completed",
    nextBeforeVersion: 2,
  });
  await render();
  expect(host.querySelector("textarea")).toBeNull();
  expect(h.ready).toHaveBeenLastCalledWith(true);
  h.get.mockResolvedValueOnce({
    ...page,
    canUpdate: false,
    state: "completed",
    items: [{ ...page.items[0], id: "older", version: 1, message: "Older record" }],
  });
  await click("older");
  expect(h.get).toHaveBeenLastCalledWith(
    "/applications/app/interview",
    expect.objectContaining({ query: { limit: 20, beforeVersion: 2 } })
  );
  expect(host.textContent).toContain("Older record");
});
it.each(["complete", "cancel"])(
  "allows a reviewer to %s a confirmed interview with a reason",
  async (action) => {
    h.user = "reviewer";
    h.get.mockResolvedValue({ ...page, state: "confirmed", scheduledAt: "2020-01-01T10:00:00Z" });
    await render(true);
    await field("textarea", "Interview outcome");
    await click(action);
    expect(h.post.mock.calls[0][1].body).toMatchObject({
      action,
      expectedVersion: 2,
      message: "Interview outcome",
    });
  }
);
it("does not submit missing reasons or past scheduling times", async () => {
  h.user = "reviewer";
  await render(true);
  await click("schedule");
  expect(h.post).not.toHaveBeenCalled();
  await field("textarea", "Review");
  await field("input", "2020-01-01T10:00");
  await click("schedule");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("futureRequired");
});
it("guards duplicate submits and ignores late completion after switching accounts", async () => {
  let finish!: (value: unknown) => void;
  h.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await field("textarea", "Confirmed");
  await act(async () => {
    button("confirm")!.click();
    button("confirm")!.click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  h.user = "outsider";
  h.get.mockRejectedValue(new Error("Forbidden"));
  await render();
  const reads = h.get.mock.calls.length;
  await act(async () => {
    finish({});
  });
  await flush();
  expect(h.get).toHaveBeenCalledTimes(reads);
  expect(h.updated).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Private interview plan");
});

it("renders chronological conversation rows and sends a versioned message", async () => {
  h.get.mockResolvedValue({
    ...page,
    items: [
      ...page.items,
      {
        ...page.items[0],
        id: "earlier",
        version: 1,
        action: "message",
        actorUserId: "applicant",
        message: "Earlier question",
      },
    ],
  });
  await render(false, true);
  const entries = [...host.querySelectorAll("li")];
  expect(entries[0].textContent).toContain("Earlier question");
  expect(entries[1].textContent).toContain("Private interview plan");
  expect(entries[0].className).toContain("border-b");
  await field("textarea", "Can we discuss the delivery scope?");
  await click("send");
  expect(h.post).toHaveBeenCalledWith(
    "/applications/app/interview",
    expect.objectContaining({
      body: expect.objectContaining({
        action: "message",
        expectedVersion: 2,
        message: "Can we discuss the delivery scope?",
      }),
    })
  );
});

it("keeps approved conversations writable without reopening interview controls", async () => {
  h.get.mockResolvedValue({
    ...page,
    applicationStatus: "approved",
    canUpdate: false,
    canMessage: true,
    state: "completed",
  });
  await render(false, true);
  await flush();
  expect(host.querySelector("textarea")).not.toBeNull();
  expect(host.textContent).toContain("send");
  expect(host.textContent).not.toContain("readOnly");
  expect(
    [...host.querySelectorAll("button")].some((button) => button.textContent === "schedule")
  ).toBe(false);
  await field("textarea", "Ready to start");
  await click("send");
  expect(h.post).toHaveBeenCalledWith(
    "/applications/app/interview",
    expect.objectContaining({
      body: expect.objectContaining({ action: "message", message: "Ready to start" }),
    })
  );
});
