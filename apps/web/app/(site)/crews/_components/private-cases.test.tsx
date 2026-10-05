import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PrivateCasesScreen } from "./private-cases";
import { FeedbackAppealControl } from "./feedback-appeal-control";
import { CrewApiError } from "../_hooks/api";
const h = vi.hoisted(() => ({
  user: "alice" as string | null,
  loading: false,
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.user ? { id: h.user } : null, isLoading: h.loading }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<typeof import("../_hooks/api")>()),
  crewApi: {
    get: (...args: unknown[]) =>
      String(args[0]).endsWith("/attachments")
        ? Promise.resolve({ items: [], nextBeforeId: null })
        : h.get(...args),
    post: (...args: unknown[]) => h.post(...args),
  },
}));
const row = {
  id: "case-a",
  taskId: "task",
  openedByUserId: "alice",
  respondentUserId: "bob",
  title: "Private case",
  status: "open",
  version: 1,
  ownerAdminId: null,
  createdAt: "2026-09-25T01:00:00Z",
  updatedAt: "2026-09-25T01:00:00Z",
};
const event = {
  id: "event",
  version: 1,
  actorId: "alice",
  actorKind: "user",
  action: "open",
  message: "Private evidence",
  submissionIds: [],
  attachmentIds: [],
  createdAt: row.createdAt,
};
const detail = { ...row, events: [event], nextBeforeVersion: null };
let root: Root, host: HTMLDivElement, qc: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "alice";
  h.loading = false;
  vi.clearAllMocks();
  h.get.mockReset().mockResolvedValue(detail);
  h.post.mockReset().mockResolvedValue({ ...row, version: 2 });
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
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}
async function render(caseId: string | undefined = "case-a", appeal = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        {appeal ? (
          <FeedbackAppealControl key={h.user} userId={h.user!} feedbackId="feedback" />
        ) : (
          <PrivateCasesScreen caseId={caseId} />
        )}
      </QueryClientProvider>
    )
  );
  await flush();
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
}
async function click(label: string) {
  expect(button(label)).toBeDefined();
  await act(async () => button(label).click());
  await flush();
}
async function message(text: string) {
  await act(async () => {
    const input = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("sends discussion with a fixed version and blocks duplicate clicks", async () => {
  let done!: (v: unknown) => void;
  h.post.mockImplementation(
    () =>
      new Promise((r) => {
        done = r;
      })
  );
  await render();
  await message("Explain evidence");
  await click("send");
  await click("send");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[0]).toEqual([
    "/crew-disputes/case-a/events",
    {
      body: {
        requestKey: expect.any(String),
        expectedVersion: 1,
        action: "message",
        message: "Explain evidence",
      },
    },
  ]);
  await act(async () => done({ ...row, version: 2 }));
  await flush();
  expect(host.textContent).toContain("saved");
  expect(button("another").disabled).toBe(true);
});
it("requires explicit discard when a background update makes a draft stale", async () => {
  await render();
  await message("Old draft");
  h.get.mockResolvedValue({ ...detail, version: 2 });
  await click("refresh");
  expect(button("send").disabled).toBe(true);
  expect(host.querySelector("textarea")!.value).toBe("Old draft");
  await click("discard");
  expect(host.querySelector("textarea")!.value).toBe("");
  await message("New draft");
  await click("send");
  expect(h.post.mock.calls[0][1].body.expectedVersion).toBe(2);
});
it("uses appeal only for a resolved case without operations controls", async () => {
  h.get.mockResolvedValue({ ...detail, status: "resolved" });
  await render();
  expect(button("send")).toBeUndefined();
  expect(button("claim")).toBeUndefined();
  expect(button("resolve")).toBeUndefined();
  await message("Please reconsider");
  await click("reopen");
  expect(h.post.mock.calls[0][1].body.action).toBe("appeal");
});
it("retries the same event even after the case version advances", async () => {
  h.post
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValue({ ...row, version: 2 });
  await render();
  await message("Keep request");
  await click("send");
  const first = h.post.mock.calls[0];
  h.get.mockResolvedValue({ ...detail, version: 2 });
  await click("refresh");
  expect(host.querySelector("textarea")!.disabled).toBe(true);
  await click("retryWrite");
  expect(h.post.mock.calls[1]).toEqual(first);
});
it("hides denied history while preserving its draft version on recovery", async () => {
  await render();
  await message("Old draft");
  h.get.mockRejectedValue(new CrewApiError(403, { message: "Denied" }));
  await click("refresh");
  expect(host.textContent).not.toContain("Private evidence");
  expect(host.querySelector("textarea")).toBeNull();
  h.get.mockResolvedValue({ ...detail, version: 2 });
  await click("refresh");
  expect(host.querySelector("textarea")!.value).toBe("Old draft");
  expect(button("send").disabled).toBe(true);
});
it("does not expose a foreign case", async () => {
  h.get.mockResolvedValue({ ...detail, openedByUserId: "foreign", respondentUserId: "other" });
  await render();
  expect(host.textContent).not.toContain("Private evidence");
  expect(host.querySelector("textarea")).toBeNull();
});
it("ignores a late write after changing account", async () => {
  let done!: (v: unknown) => void;
  h.post.mockImplementation(
    () =>
      new Promise((r) => {
        done = r;
      })
  );
  await render();
  await message("Private message");
  await click("send");
  h.user = "other";
  await render();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  await act(async () => done({ ...row, version: 2 }));
  await flush();
  expect(invalidate).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("saved");
});
it("paginates case history using versions", async () => {
  h.get.mockResolvedValueOnce({ ...detail, nextBeforeVersion: 4 }).mockResolvedValue({
    ...detail,
    events: [{ ...event, id: "older", message: "Earlier evidence" }],
  });
  await render();
  await click("moreHistory");
  expect(h.get.mock.calls[1][1].query).toEqual({ limit: 20, beforeVersion: 4 });
  expect(host.textContent).toContain("Earlier evidence");
});
it("lists only participant cases and paginates using case cursors", async () => {
  h.get
    .mockResolvedValueOnce({
      items: [
        row,
        {
          ...row,
          id: "foreign",
          title: "Hidden",
          openedByUserId: "other",
          respondentUserId: "another",
        },
      ],
      nextBeforeId: "case-a",
    })
    .mockResolvedValue({ items: [], nextBeforeId: null });
  // Explicitly render the list (undefined would use the helper default).
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <PrivateCasesScreen />
      </QueryClientProvider>
    )
  );
  await flush();
  expect(host.textContent).not.toContain("Hidden");
  expect(host.querySelector('a[href="/en-US/resolution-center/case-a"]')).not.toBeNull();
  await click("moreCases");
  expect(h.get.mock.calls[1][1].query).toEqual({
    limit: 20,
    beforeId: "case-a",
    view: "all",
    lifecycle: "all",
  });
});
it.each([true, false])("does not query while unauthenticated/loading (%s)", async (loading) => {
  h.user = loading ? "alice" : null;
  h.loading = loading;
  await render();
  expect(h.get).not.toHaveBeenCalled();
});
it("opens a feedback appeal with only generated ID and reason; retries exactly", async () => {
  h.post
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValue({ feedbackId: "feedback", dispute: { id: "case-a" } });
  await render(undefined, true);
  expect(button("appealFeedback").disabled).toBe(true);
  await message("Review my rating");
  await click("appealFeedback");
  const first = h.post.mock.calls[0];
  expect(first).toEqual([
    "/crew-task-feedback/feedback/appeals",
    { body: { id: expect.any(String), reason: "Review my rating" } },
  ]);
  await click("retryWrite");
  expect(h.post.mock.calls[1]).toEqual(first);
  expect(host.querySelector('a[href="/en-US/resolution-center/case-a"]')).not.toBeNull();
  expect(host.querySelector("textarea")).toBeNull();
});
it("offers existing cases after an appeal conflict without automatic extra writes", async () => {
  h.post.mockRejectedValue(new CrewApiError(409, { message: "Case already open" }));
  await render(undefined, true);
  await message("Review request");
  await click("appealFeedback");
  expect(host.textContent).toContain("Case already open");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(host.querySelector('a[href="/en-US/resolution-center"]')).not.toBeNull();
});

it("keeps a confirmed event complete through failed refresh and restores only after a readable version", async () => {
  await render();
  await message("Save once");
  h.get.mockRejectedValue(new Error("Read failed"));
  await click("send");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(host.querySelector("textarea")).toBeNull();
  h.get.mockResolvedValue({ ...detail, version: 2 });
  await click("refresh");
  expect(host.textContent).toContain("saved");
  expect(button("send")).toBeUndefined();
  await click("another");
  expect(host.querySelector("textarea")!.value).toBe("");
});
it("retains uncertain event recovery through a denied read", async () => {
  h.post
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValue({ ...row, version: 2 });
  await render();
  await message("Retry unchanged");
  await click("send");
  const first = h.post.mock.calls[0];
  h.get.mockRejectedValue(new CrewApiError(403, { message: "Denied" }));
  await click("refresh");
  expect(button("retryWrite")).toBeUndefined();
  h.get.mockResolvedValue({ ...detail, version: 2 });
  await click("refresh");
  await click("retryWrite");
  expect(h.post.mock.calls[1]).toEqual(first);
});
it("clears the draft when navigating to another case", async () => {
  await render();
  await message("Case A only");
  h.get.mockResolvedValue({ ...detail, id: "case-b" });
  await render("case-b");
  expect(host.querySelector("textarea")!.value).toBe("");
  await message("Case B");
  await click("send");
  expect(h.post.mock.calls[0][0]).toBe("/crew-disputes/case-b/events");
});

it("switches case tabs with a fresh cursor and independent query", async () => {
  h.get.mockResolvedValue({ items: [row], nextBeforeId: null });
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <PrivateCasesScreen />
      </QueryClientProvider>
    )
  );
  await flush();
  expect(h.get.mock.calls[0][1].query.view).toBe("all");
  await click("responses");
  await flush();
  expect(h.get.mock.calls.at(-1)![1].query).toEqual({
    limit: 20,
    view: "responses",
    lifecycle: "all",
    beforeId: undefined,
  });
});

it("changes lifecycle without carrying the previous page cursor", async () => {
  h.get.mockResolvedValue({ items: [row], nextBeforeId: "case-a" });
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <PrivateCasesScreen />
      </QueryClientProvider>
    )
  );
  await flush();
  await click("moreCases");
  expect(h.get.mock.calls.at(-1)![1].query.beforeId).toBe("case-a");
  await click("lifecycle.archived");
  expect(h.get.mock.calls.at(-1)![1].query).toEqual({
    limit: 20,
    view: "all",
    lifecycle: "archived",
    beforeId: undefined,
  });
  await click("responses");
  expect(h.get.mock.calls.at(-1)![1].query).toEqual({
    limit: 20,
    view: "responses",
    lifecycle: "archived",
    beforeId: undefined,
  });
  await click("lifecycle.active");
  expect(h.get.mock.calls.at(-1)![1].query.lifecycle).toBe("active");
});
