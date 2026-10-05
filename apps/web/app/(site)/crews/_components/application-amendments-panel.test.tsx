import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApplicationAmendmentsPanel } from "./application-amendments-panel";
import { CrewApiError } from "../_hooks/api";
const h = vi.hoisted(() => ({
  user: "reviewer",
  get: vi.fn(),
  post: vi.fn(),
  termsVersion: 2,
  taskVersion: 5,
  permissions: ["applications.review", "tasks.manage"],
  membershipError: false,
  taskCalls: vi.fn(),
  memberCalls: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: h.user } }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<typeof import("../_hooks/api")>()),
  crewApi: {
    get: (...args: unknown[]) => h.get(...args),
    post: (...args: unknown[]) => h.post(...args),
  },
}));
vi.mock("../_hooks/use-application-terms", async (original) => ({
  ...(await original<typeof import("../_hooks/use-application-terms")>()),
  useApplicationTerms: () => ({
    isSuccess: true,
    isError: false,
    isFetching: false,
    refetch: h.refetch,
    data: {
      currentVersion: h.termsVersion,
      items: [
        {
          version: h.termsVersion,
          scope: "Original work",
          feeAmount: "10000",
          currency: "USD",
          feePeriod: "project",
          paymentTerms: null,
          revenueShareBp: 0,
          shareBasis: null,
          confirmedAt: "2026-09-25T00:00:00Z",
        },
      ],
    },
  }),
}));
vi.mock("../_hooks/use-members", () => ({
  useCrewMembership: (id: unknown) => {
    h.memberCalls(id);
    return {
      isSuccess: !h.membershipError,
      isError: h.membershipError,
      error: new Error("Permission denied"),
      refetch: h.refetch,
      data: { permissions: h.permissions },
    };
  },
}));
vi.mock("../_hooks/use-tasks", () => ({
  useCrewTask: (id: unknown, enabled: unknown) => {
    h.taskCalls(id, enabled);
    return {
      isSuccess: true,
      isError: false,
      refetch: h.refetch,
      data: { id: "task", crewId: "crew", version: h.taskVersion },
    };
  },
}));
const row = {
  id: "amendment",
  applicationId: "application",
  taskId: "task",
  applicantId: "creator",
  proposedByUserId: "reviewer",
  status: "pending",
  confirmedAt: null,
  settledByUserId: null,
  settledAt: null,
  proposal: {
    id: "amendment",
    expectedVersion: 2,
    expectedTaskVersion: 5,
    scope: "Proposed work",
    feeAmount: "12000",
    currency: "USD",
    feePeriod: "project",
    revenueShareBp: 250,
    shareBasis: "Written basis",
    reason: "More work",
  },
};
let root: Root, host: HTMLDivElement, qc: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "reviewer";
  h.termsVersion = 2;
  h.taskVersion = 5;
  h.permissions = ["applications.review", "tasks.manage"];
  h.membershipError = false;
  vi.clearAllMocks();
  h.get.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  h.post.mockReset().mockResolvedValue(row);
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
    await new Promise((r) => setTimeout(r, 25));
  });
}
async function render(
  reviewer = true,
  applicationId = "application",
  status = "approved",
  taskId: string | null = "task"
) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <ApplicationAmendmentsPanel
          applicationId={applicationId}
          applicantId="creator"
          crewId="crew"
          taskId={taskId}
          status={status}
          reviewer={reviewer}
        />
      </QueryClientProvider>
    )
  );
  await flush();
}
function button(key: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
}
async function click(key: string) {
  expect(button(key)).toBeDefined();
  await act(async () => button(key).click());
  await flush();
}
async function field(label: string, value: string) {
  await act(async () => {
    const el = [...host.querySelectorAll("label")]
      .find((l) => l.textContent?.startsWith(label))!
      .querySelector("input,textarea")!;
    const proto =
      el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function proposal() {
  await render();
  await click("propose");
  await field("reason", "Additional work");
}
it("submits exact project fee, unchanged currency and captured versions", async () => {
  await proposal();
  await field("fee", "120.01");
  await field("share", "2.5");
  await field("basis", "Agreed basis");
  await click("sendProposal");
  expect(h.post).toHaveBeenCalledWith("/applications/application/amendments", {
    body: {
      id: expect.any(String),
      expectedVersion: 2,
      expectedTaskVersion: 5,
      scope: "Original work",
      feeAmount: "12001",
      currency: "USD",
      feePeriod: "project",
      paymentTerms: null,
      revenueShareBp: 250,
      shareBasis: "Agreed basis",
      reason: "Additional work",
    },
  });
});
it("preserves draft versions through background changes and collapse/reopen", async () => {
  await proposal();
  await field("fee", "123");
  await click("collapse");
  h.termsVersion = 3;
  h.taskVersion = 6;
  await render();
  await click("expand");
  expect(button("sendProposal").disabled).toBe(true);
  expect(host.textContent).toContain("stale");
  await click("discard");
  await field("reason", "Updated proposal");
  await click("sendProposal");
  expect(h.post.mock.calls[0][1].body).toEqual(
    expect.objectContaining({ expectedVersion: 3, expectedTaskVersion: 6, feeAmount: "10000" })
  );
});
it.each(["100000000.01", "-1", "1.001"])("rejects unsupported fee %s", async (fee) => {
  await proposal();
  await field("fee", fee);
  expect(button("sendProposal").disabled).toBe(true);
});
it("allows zero fee and requires share basis without inventing calculations", async () => {
  await proposal();
  await field("fee", "0");
  await field("share", "50.01");
  expect(button("sendProposal").disabled).toBe(true);
  await field("share", "50");
  expect(button("sendProposal").disabled).toBe(true);
  await field("basis", "Agreed gross basis");
  expect(button("sendProposal").disabled).toBe(false);
  await click("sendProposal");
  expect(h.post.mock.calls[0][1].body.feeAmount).toBe("0");
});
it.each([
  { permissions: ["applications.review"] },
  { permissions: ["tasks.manage"] },
  { permissions: [] },
])("requires both proposal permissions (%j)", async ({ permissions }) => {
  h.permissions = permissions;
  await render();
  expect(button("propose")).toBeUndefined();
});
it("does not offer self-proposals", async () => {
  h.user = "creator";
  await render();
  expect(button("propose")).toBeUndefined();
});
it("preserves exact proposal retry through task version changes", async () => {
  h.post.mockRejectedValueOnce(new Error("Lost response")).mockResolvedValue(row);
  await proposal();
  await click("sendProposal");
  const first = h.post.mock.calls[0];
  h.taskVersion = 9;
  await render();
  await click("retry");
  expect(h.post.mock.calls[1]).toEqual(first);
});
it("offers creator consent and rejection after departure without task access", async () => {
  h.user = "creator";
  h.membershipError = true;
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  h.post.mockResolvedValue({
    ...row,
    status: "awaiting_settlement",
    confirmedAt: "2026-09-25T00:00:00Z",
  });
  await render(false);
  expect(h.memberCalls).toHaveBeenCalledWith(undefined);
  expect(h.taskCalls).toHaveBeenCalledWith("task", false);
  expect(host.textContent).toContain("Proposed work");
  expect(host.textContent).toContain("Original work");
  await click("confirm");
  expect(h.post.mock.calls[0]).toEqual([
    "/applications/application/amendments/amendment/decision",
    { body: { action: "confirm" } },
  ]);
  expect(host.textContent).toContain("status.awaiting_settlement");
  expect(button("confirm")).toBeUndefined();
  expect(button("reject")).toBeDefined();
  expect(button("withdraw")).toBeUndefined();
});
it.each(["awaiting_settlement", "settlement_requested", "effective", "rejected", "withdrawn"])(
  "does not reconfirm %s",
  async (status) => {
    h.user = "creator";
    h.get.mockResolvedValue({ items: [{ ...row, status }], nextCursor: null });
    await render(false);
    expect(button("confirm")).toBeUndefined();
    expect(Boolean(button("reject"))).toBe(status === "awaiting_settlement");
  }
);
it("only the currently authorized proposer can withdraw", async () => {
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  await render();
  expect(button("withdraw")).toBeDefined();
  h.user = "other-reviewer";
  await render();
  expect(button("withdraw")).toBeUndefined();
  h.user = "reviewer";
  h.membershipError = true;
  await render();
  expect(button("withdraw")).toBeUndefined();
});
it("retries the exact decision after the history changes", async () => {
  h.user = "creator";
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  h.post
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValue({ ...row, status: "effective" });
  await render(false);
  await click("confirm");
  const first = h.post.mock.calls[0];
  h.get.mockResolvedValue({ items: [{ ...row, status: "effective" }], nextCursor: null });
  await click("refresh");
  await click("retry");
  expect(h.post.mock.calls[1]).toEqual(first);
});
it("hides denied history and blocks consent", async () => {
  h.user = "creator";
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  await render(false);
  h.get.mockRejectedValue(new CrewApiError(403, { message: "Denied" }));
  await click("refresh");
  expect(host.textContent).not.toContain("Proposed work");
  expect(button("confirm")).toBeUndefined();
});
it("paginates private history and filters mismatched rows", async () => {
  h.get
    .mockResolvedValueOnce({ items: [{ ...row, applicationId: "foreign" }], nextCursor: "cursor" })
    .mockResolvedValue({ items: [row], nextCursor: null });
  await render();
  expect(host.textContent).not.toContain("Proposed work");
  await click("more");
  expect(h.get.mock.calls[1][1].query).toEqual({ limit: 20, cursor: "cursor" });
  expect(host.textContent).toContain("Proposed work");
});
it("suppresses duplicate writes and late account-switch effects", async () => {
  let done!: (v: unknown) => void;
  h.post.mockImplementation(
    () =>
      new Promise((r) => {
        done = r;
      })
  );
  await proposal();
  await click("sendProposal");
  await click("sendProposal");
  expect(h.post).toHaveBeenCalledTimes(1);
  h.user = "other";
  await render();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  await act(async () => done(row));
  expect(invalidate).not.toHaveBeenCalled();
  expect(host.querySelector("textarea")).toBeNull();
});
it("never labels a failed refresh as a failed write or re-enables its proposal", async () => {
  await proposal();
  h.get.mockRejectedValue(new Error("History unavailable"));
  await click("sendProposal");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(button("sendProposal")).toBeUndefined();
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  await click("refresh");
  expect(host.textContent).toContain("saved");
  expect(button("propose")).toBeUndefined();
});
it.each([
  ["pending", "task"],
  ["approved", null],
])("does not query inapplicable recruitment %s/%s", async (status, taskId) => {
  await render(true, "application", status!, taskId);
  expect(h.get).not.toHaveBeenCalled();
});

it("adopts another participant's later decision instead of pinning the saved proposal", async () => {
  await proposal();
  await click("sendProposal");
  h.get.mockResolvedValue({ items: [{ ...row, status: "effective" }], nextCursor: null });
  h.termsVersion = 3;
  h.taskVersion = 6;
  await click("refresh");
  expect(button("withdraw")).toBeUndefined();
  expect(button("propose")).toBeDefined();
});
