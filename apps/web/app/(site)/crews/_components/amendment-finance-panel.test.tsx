import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AmendmentFinancePanel } from "./amendment-finance-panel";
import { CrewApiError } from "../_hooks/api";
import { amendmentFinanceKey } from "../_hooks/use-amendment-finance-queue";
import type { ApplicationAmendment } from "../_hooks/use-application-amendments";

const h = vi.hoisted(() => ({
  user: "finance" as string | null,
  permissions: ["finance.earnings.approve"],
  membershipError: false,
  get: vi.fn(),
  post: vi.fn(),
  memberRefresh: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.user ? { id: h.user } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("../_hooks/api", async (original) => ({
  ...(await original<typeof import("../_hooks/api")>()),
  crewApi: {
    get: (...args: unknown[]) => h.get(...args),
    post: (...args: unknown[]) => h.post(...args),
  },
}));
vi.mock("../_hooks/use-members", () => ({
  useCrewMembership: () => ({
    isSuccess: !h.membershipError,
    isError: h.membershipError,
    isPending: false,
    error: h.membershipError ? new Error("Membership unavailable") : null,
    data: { permissions: h.permissions },
    refetch: h.memberRefresh,
  }),
}));
const row: ApplicationAmendment = {
  id: "11111111-1111-4111-8111-111111111111",
  applicationId: "app",
  taskId: "task",
  applicantId: "creator",
  proposedByUserId: "producer",
  status: "awaiting_settlement",
  confirmedAt: "2026-09-25T00:00:00Z",
  settledAt: null,
  settledByUserId: null,
  proposal: {
    id: "11111111-1111-4111-8111-111111111111",
    expectedVersion: 2,
    expectedTaskVersion: 5,
    scope: "Agreed private scope",
    paymentTerms: "half_upfront",
    feeAmount: "10000000000",
    currency: "USD",
    feePeriod: "project",
    revenueShareBp: 125,
    shareBasis: "Agreed basis",
    reason: "Additional work",
  },
};
const settled = {
  ...row,
  status: "effective",
  settledAt: "2026-09-25T02:00:00Z",
  settledByUserId: "finance",
};
let root: Root, host: HTMLDivElement, qc: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "finance";
  h.permissions = ["finance.earnings.approve"];
  h.membershipError = false;
  vi.clearAllMocks();
  h.get.mockReset().mockResolvedValue({ items: [row], nextCursor: null });
  h.post.mockReset().mockResolvedValue(settled);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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
async function render(crewId = "crew") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <AmendmentFinancePanel crewId={crewId} />
      </QueryClientProvider>
    )
  );
  await flush();
}
function button(key: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === key);
}
async function click(key: string) {
  expect(button(key)).toBeDefined();
  await act(async () => button(key)!.click());
  await flush();
}
async function start() {
  await render();
  await click("review");
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it("uses the finance-only Crew queue and requires explicit review and confirmation", async () => {
  await render();
  expect(h.get).toHaveBeenCalledWith(
    "/crews/crew/application-amendments",
    expect.objectContaining({
      cache: "no-store",
      query: { status: "awaiting_settlement", limit: 20, cursor: undefined },
    })
  );
  expect(h.get.mock.calls.every(([path]) => path === "/crews/crew/application-amendments")).toBe(
    true
  );
  expect(host.textContent).toContain("USD 100000000.00");
  expect(host.textContent).toContain("label: half_upfront");
  expect(host.textContent).toContain("1.25%");
  expect(button("apply")).toBeUndefined();
  expect(h.post).not.toHaveBeenCalled();
  await click("review");
  expect(host.textContent).toContain("confirmation");
  expect(h.post).not.toHaveBeenCalled();
  await click("apply");
  expect(h.post).toHaveBeenCalledExactlyOnceWith(`/applications/app/amendments/${row.id}/settle`);
  expect(host.textContent).toContain("effectiveResult");
  expect(button("review")).toBeUndefined();
});
it.each([null, "ordinary"])("does not fetch private finance data for %s", async (account) => {
  h.user = account;
  h.permissions = [];
  await render();
  expect(h.get).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Agreed private scope");
});
it("hides cached records and review controls after permission loss", async () => {
  await start();
  h.permissions = [];
  await render();
  expect(host.textContent).not.toContain("Agreed private scope");
  expect(button("apply")).toBeUndefined();
});
it("hides private data after membership read failure", async () => {
  await start();
  h.membershipError = true;
  await render();
  expect(host.textContent).toContain("Membership unavailable");
  expect(host.textContent).not.toContain("Agreed private scope");
});
it("manual requests remain read-only and do not imply a refund", async () => {
  h.get.mockImplementation((_path, options) =>
    Promise.resolve({
      items:
        options.query.status === "settlement_requested"
          ? [{ ...settled, status: "settlement_requested" }]
          : [],
      nextCursor: null,
    })
  );
  await render();
  await click("settlement_requested");
  expect(host.textContent).toContain("manualResult");
  expect(button("review")).toBeUndefined();
  expect(button("apply")).toBeUndefined();
  expect(h.post).not.toHaveBeenCalled();
});
it("shows a manual settlement result separately from activated terms", async () => {
  h.post.mockResolvedValue({ ...settled, status: "settlement_requested" });
  await start();
  await click("apply");
  expect(host.textContent).toContain("manualResult");
  expect(host.textContent).not.toContain("effectiveResult");
});
it.each(["confirmedAt", "settledAt"])("does not execute when %s is ineligible", async (field) => {
  h.get.mockResolvedValue({
    items: [{ ...row, [field]: field === "confirmedAt" ? null : "2026-09-25T02:00:00Z" }],
    nextCursor: null,
  });
  await render();
  expect(button("review")).toBeUndefined();
});
it("a changed record requires fresh review instead of reusing confirmation", async () => {
  await start();
  await act(async () =>
    qc.setQueryData(amendmentFinanceKey("crew", "awaiting_settlement", "finance"), {
      pages: [
        { items: [{ ...row, proposal: { ...row.proposal, reason: "Changed" } }], nextCursor: null },
      ],
      pageParams: [undefined],
    })
  );
  await flush();
  expect(button("apply")?.disabled).toBe(true);
  expect(host.textContent).toContain("stale");
  await click("cancel");
  await click("review");
  expect(button("apply")?.disabled).toBe(false);
});
it.each([400, 409, 422])("surfaces definitive %s and requires new review", async (status) => {
  h.post.mockRejectedValue(new CrewApiError(status, { message: "Obtain renewed consent" }));
  await start();
  await click("apply");
  expect(host.textContent).toContain("Obtain renewed consent");
  expect(button("retry")).toBeUndefined();
  expect(button("apply")).toBeUndefined();
});
it.each([401, 403])("hides private records after write denial %s", async (status) => {
  h.post.mockRejectedValue(new CrewApiError(status, { message: "Finance access removed" }));
  await start();
  await click("apply");
  expect(host.textContent).toContain("Finance access removed");
  expect(host.textContent).not.toContain("Agreed private scope");
  expect(button("review")).toBeUndefined();
});
it("retries the identical amendment after a lost response even if it left the queue", async () => {
  h.post.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce(settled);
  await start();
  await click("apply");
  expect(button("settlement_requested")?.disabled).toBe(true);
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  await click("refresh");
  await click("retry");
  expect(h.post.mock.calls[0]).toEqual(h.post.mock.calls[1]);
  expect(host.textContent).toContain("effectiveResult");
  expect(button("retry")).toBeUndefined();
});
it("rejects a mismatched response as uncertain and retains exact recovery", async () => {
  h.post.mockResolvedValue({ ...settled, applicationId: "foreign" });
  await start();
  await click("apply");
  expect(host.textContent).toContain("unknownResult");
  expect(button("retry")).toBeDefined();
  expect(host.textContent).not.toContain("effectiveResult");
});
it("a successful correction stays complete when queue refresh fails", async () => {
  await start();
  h.get.mockRejectedValue(new Error("Refresh unavailable"));
  await click("apply");
  expect(host.textContent).toContain("effectiveResult");
  expect(host.textContent).toContain("Refresh unavailable");
  expect(button("retry")).toBeUndefined();
});
it("paginates with the selected Crew, status and cursor, and restarts refresh at the first page", async () => {
  const second = { ...row, id: "22222222-2222-4222-8222-222222222222", applicationId: "second" };
  h.get.mockImplementation((_path, options) =>
    Promise.resolve(
      options.query.cursor
        ? { items: [second], nextCursor: null }
        : { items: [row], nextCursor: row.id }
    )
  );
  await render();
  await click("more");
  expect(h.get).toHaveBeenLastCalledWith(
    "/crews/crew/application-amendments",
    expect.objectContaining({ query: { status: "awaiting_settlement", limit: 20, cursor: row.id } })
  );
  expect(host.textContent).toContain("second");
  await click("refresh");
  expect(host.textContent).not.toContain('"application":"second"');
  expect(h.get).toHaveBeenLastCalledWith(
    "/crews/crew/application-amendments",
    expect.objectContaining({
      query: { status: "awaiting_settlement", limit: 20, cursor: undefined },
    })
  );
});
it("failed reads hide cached history until a fresh read succeeds", async () => {
  await start();
  h.get.mockRejectedValue(new Error("Queue denied"));
  await act(async () => {
    await qc.invalidateQueries({ queryKey: ["crew-amendment-finance"] });
  });
  await flush();
  expect(host.textContent).not.toContain("Agreed private scope");
  expect(button("apply")).toBeUndefined();
});
it("guards duplicate clicks and invalidates only the initiating account", async () => {
  const request = deferred<typeof settled>();
  h.post.mockReturnValue(request.promise);
  await start();
  const invalidation = vi.spyOn(qc, "invalidateQueries");
  await act(async () => {
    button("apply")!.click();
    button("apply")!.click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  await act(async () => request.resolve(settled));
  await flush();
  const filters = invalidation.mock.calls.map(([filter]) => filter!);
  expect(filters.some((filter) => filter.queryKey?.[0] === "crew-application-terms")).toBe(true);
  const crew = filters.find((filter) => filter.queryKey?.[0] === "crew")!;
  expect(crew.predicate!({ queryKey: ["crew", "earnings", "crew", "finance"] } as never)).toBe(
    true
  );
  expect(crew.predicate!({ queryKey: ["crew", "earnings", "crew", "other"] } as never)).toBe(false);
});
it.each(["account", "crew"])(
  "clears review and suppresses late response on %s change",
  async (change) => {
    const request = deferred<typeof settled>();
    h.post.mockReturnValue(request.promise);
    await start();
    await act(async () => button("apply")!.click());
    if (change === "account") h.user = "other";
    await render(change === "crew" ? "other-crew" : "crew");
    const invalidation = vi.spyOn(qc, "invalidateQueries");
    await act(async () => request.resolve(settled));
    await flush();
    expect(host.textContent).not.toContain("effectiveResult");
    expect(button("apply")).toBeUndefined();
    expect(invalidation).not.toHaveBeenCalled();
  }
);

it("blocks uncertain correction recovery after a denied queue read until refresh succeeds", async () => {
  h.post.mockRejectedValueOnce(new Error("Lost response")).mockResolvedValueOnce(settled);
  await start();
  await click("apply");
  h.get.mockRejectedValue(new CrewApiError(403, { message: "Queue denied" }));
  await act(async () => {
    await qc.invalidateQueries({ queryKey: ["crew-amendment-finance"] });
  });
  await flush();
  expect(button("retry")?.disabled).toBe(true);
  await click("retry");
  expect(h.post).toHaveBeenCalledTimes(1);
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  await click("refresh");
  await click("retry");
  expect(h.post).toHaveBeenCalledTimes(2);
});
it("does not carry private cached records into a loading account or Crew", async () => {
  await start();
  h.user = "new-viewer";
  const request = deferred<{ items: ApplicationAmendment[]; nextCursor: null }>();
  h.get.mockReturnValue(request.promise);
  await render("other-crew");
  expect(host.textContent).not.toContain("Agreed private scope");
  expect(button("apply")).toBeUndefined();
  await act(async () => request.resolve({ items: [], nextCursor: null }));
  await flush();
});
it("preserves the original target when the filter changes and requires a fresh review", async () => {
  await start();
  await click("settlement_requested");
  await click("awaiting_settlement");
  expect(button("apply")).toBeUndefined();
  expect(h.post).not.toHaveBeenCalled();
});
