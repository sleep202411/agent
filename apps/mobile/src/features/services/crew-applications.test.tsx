import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api-client";
import { CrewApplications } from "./crew-applications";
vi.mock("@/lib/api-client", () => ({
  ApiRequestError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("./user-displays", () => ({ useUserDisplays: () => undefined }));
vi.mock("./application-review", () => ({
  ApplicationReview: ({ initialApplicationId }: { initialApplicationId?: string }) => (
    <span>Review:{initialApplicationId}</span>
  ),
}));
vi.mock("./application-amendments", () => ({
  ApplicationAmendments: ({ onClose, taskId }: { onClose: () => void; taskId: string }) => (
    <button data-task-id={taskId} onClick={onClose}>
      Amendments
    </button>
  ),
}));
vi.mock("./application-interview", () => ({ ApplicationInterview: () => <span>Interview</span> }));
vi.mock("./position-invitations", () => ({ PositionInvitations: () => <span>Invitations</span> }));
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  list: vi.fn(),
  terms: vi.fn(),
  thread: vi.fn(),
  confirm: vi.fn(),
  web: vi.fn(),
  push: vi.fn(),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("./application-terms-api", () => ({
  fetchMyApplications: h.list,
  fetchApplicationTerms: h.terms,
  acceptApplicationOffer: h.confirm,
  fetchApplicationThread: h.thread,
}));
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ border: "gray", brand: "red", backgroundElement: "black" }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./crew-finance-api", () => ({
  formatFinanceMoney: (value: string, currency: string) => `${currency} ${value}`,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  TextInput: ({ value, onChangeText }: { value: string; onChangeText: (s: string) => void }) => (
    <input value={value} onChange={(e) => onChangeText(e.target.value)} />
  ),
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
const app = {
  id: "app",
  crewId: "crew",
  applicantId: "creator",
  crewName: "Crew",
  positionType: "Director",
  taskId: null,
  status: "pending",
  createdAt: "2026-09-30T00:00:00Z",
};
const row = {
  id: "00000000-0000-4000-8000-000000000001",
  applicationId: "app",
  version: 2,
  scope: "Storyboards",
  feeAmount: "12345",
  currency: "USD",
  feePeriod: "episode",
  revenueShareBp: 250,
  shareBasis: "Net receipts",
  proposedByUserId: "producer",
  createdAt: app.createdAt,
  confirmedAt: null,
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = async (label: string) => {
  await act(async () => button(label).click());
};
const render = async () => {
  await act(async () =>
    root.render(<CrewApplications userId="creator" generation={1} onWeb={h.web} />)
  );
};
const open = async () => {
  await render();
  await click("Crew · Director · 2026-09-30 · crewTerms.pending");
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.list.mockResolvedValue({ items: [app], nextCursor: null });
  h.thread.mockResolvedValue(app);
  h.terms.mockResolvedValue({ currentVersion: 2, items: [row], nextBeforeVersion: null });
  h.confirm.mockResolvedValue({ ...row, confirmedAt: "2026-09-30T01:00:00Z" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("shows terms before explicit applicant confirmation", async () => {
  await open();
  expect(host.textContent).toContain("Storyboards");
  expect(host.textContent).toContain("2.50%");
  expect(host.textContent).toContain("crewOffers.effect");
  expect(h.confirm).not.toHaveBeenCalled();
  await click("crewOffers.accept");
  expect(h.confirm).toHaveBeenCalledWith(app, row, "creator", 1);
  expect(host.textContent).toContain("crewTerms.confirmed");
  expect(button("nativeApplications.retry")).toBeUndefined();
});
it("blocks duplicate confirmation and navigation while pending", async () => {
  let resolve!: (value: unknown) => void;
  h.confirm.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await open();
  await act(async () => {
    button("crewOffers.accept").click();
    button("crewOffers.accept").click();
  });
  expect(h.confirm).toHaveBeenCalledTimes(1);
  expect(button("crewTerms.refresh").disabled).toBe(true);
  expect(button("nativeApplications.back").disabled).toBe(true);
  expect(button("nativeApplications.webWorkflow").disabled).toBe(true);
  await act(async () => resolve({ ...row, confirmedAt: app.createdAt }));
});
it("retries identical reviewed terms after a network error", async () => {
  h.confirm.mockRejectedValueOnce(new Error("Network"));
  await open();
  await click("crewOffers.accept");
  expect(host.textContent).toContain("Network");
  await click("nativeApplications.retry");
  expect(h.confirm.mock.calls[0]).toEqual(h.confirm.mock.calls[1]);
  expect(host.textContent).not.toContain("Network");
});
it("requires refresh after a version conflict", async () => {
  h.confirm.mockRejectedValue(Object.assign(new Error("Terms changed"), { status: 409 }));
  await open();
  await click("crewOffers.accept");
  expect(button("nativeApplications.retry").disabled).toBe(true);
  h.terms.mockResolvedValue({
    currentVersion: 3,
    items: [{ ...row, version: 3, scope: "Revised scope" }],
    nextBeforeVersion: null,
  });
  await click("crewTerms.refresh");
  expect(host.textContent).toContain("Revised scope");
  expect(h.confirm).toHaveBeenCalledTimes(1);
  expect(button("crewOffers.accept").disabled).toBe(false);
});
it("never confirms an older history version", async () => {
  h.terms
    .mockResolvedValueOnce({ currentVersion: 2, items: [row], nextBeforeVersion: 2 })
    .mockResolvedValueOnce({
      currentVersion: 2,
      items: [{ ...row, version: 1 }],
      nextBeforeVersion: null,
    });
  await open();
  await click("nativeApplications.history");
  expect(h.terms).toHaveBeenLastCalledWith("app", 2, expect.any(AbortSignal));
  expect(button("crewOffers.accept")).toBeUndefined();
});
it.each(["approved", "rejected"])("does not confirm a %s application", async (status) => {
  h.list.mockResolvedValue({ items: [{ ...app, status }], nextCursor: null });
  h.thread.mockResolvedValue({ ...app, status });
  await render();
  await click(`Crew · Director · 2026-09-30 · crewTerms.${status}`);
  expect(button("crewOffers.accept")).toBeUndefined();
});
it("preserves access to existing Web workflows", async () => {
  await render();
  await click("nativeApplications.webWorkflow");
  expect(h.web).toHaveBeenCalledTimes(1);
});
it("refreshes the directory when returning from terms", async () => {
  await open();
  await click("nativeApplications.back");
  expect(h.list).toHaveBeenCalledTimes(2);
});
it("does not display a late previous-account response", async () => {
  let resolve!: (value: unknown) => void;
  h.list.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  h.generation = 2;
  await act(async () => resolve({ items: [app], nextCursor: null }));
  expect(host.textContent).not.toContain("Director");
});
it("hides records on paging failure", async () => {
  h.list
    .mockResolvedValueOnce({ items: [app], nextCursor: "app" })
    .mockRejectedValueOnce(new Error("Expired session"));
  await render();
  await click("crewTerms.more");
  expect(host.textContent).toContain("Expired session");
  expect(host.textContent).not.toContain("Director");
});
it("unmounts private content while inactive", async () => {
  await open();
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
});
it("appends later applications while preserving earlier rows", async () => {
  h.list.mockResolvedValueOnce({ items: [app], nextCursor: "app" }).mockResolvedValueOnce({
    items: [{ ...app, id: "older", crewName: "Older Crew" }],
    nextCursor: null,
  });
  await render();
  await click("crewTerms.more");
  expect(button("Crew · Director · 2026-09-30 · crewTerms.pending")).toBeDefined();
  expect(button("Older Crew · Director · 2026-09-30 · crewTerms.pending")).toBeDefined();
});
it("rejects duplicate applications across pages", async () => {
  h.list
    .mockResolvedValueOnce({ items: [app], nextCursor: "app" })
    .mockResolvedValueOnce({ items: [app], nextCursor: null });
  await render();
  await click("crewTerms.more");
  expect(host.textContent).toContain("pagination changed");
  expect(host.textContent).not.toContain("Director");
});
it("opens native interview history from an application", async () => {
  await open();
  await click("crewInterview.title");
  expect(host.textContent).toBe("Interview");
});

it("opens native invitation inbox", async () => {
  await render();
  await click("crewPositionInvites.title");
  expect(host.textContent).toBe("Invitations");
});

it("opens approved task amendments and reloads terms on return", async () => {
  h.thread.mockResolvedValue({
    ...app,
    status: "approved",
    taskId: "00000000-0000-4000-8000-000000000002",
  });
  h.list.mockResolvedValue({
    items: [{ ...app, status: "approved", taskId: "00000000-0000-4000-8000-000000000002" }],
    nextCursor: null,
  });
  await render();
  await click("Crew · Director · 2026-09-30 · crewTerms.approved");
  await click("crewAmendments.title");
  expect(host.textContent).toBe("Amendments");
  await click("Amendments");
  expect(h.terms).toHaveBeenCalledTimes(2);
});

it("uses the exact current thread status instead of stale inbox status", async () => {
  h.thread.mockResolvedValue({ ...app, status: "approved" });
  await open();
  expect(button("crewOffers.accept")).toBeUndefined();
});
it("permits acceptance of a pending offer whose terms were already confirmed", async () => {
  h.terms.mockResolvedValue({
    currentVersion: 2,
    items: [{ ...row, confirmedAt: app.createdAt }],
    nextBeforeVersion: null,
  });
  await open();
  await click("crewOffers.accept");
  expect(h.confirm).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("crewOffers.accepted");
});
it("does not expose acceptance when the thread lookup fails", async () => {
  h.thread.mockRejectedValue(new Error("Application unavailable"));
  await open();
  expect(button("crewOffers.accept")).toBeUndefined();
  expect(host.textContent).toContain("Application unavailable");
});

it("opens a requested application outside the loaded inbox page", async () => {
  await act(async () =>
    root.render(
      <CrewApplications
        userId="creator"
        generation={1}
        onWeb={h.web}
        initialApplicationId="exact"
      />
    )
  );
  expect(h.list).not.toHaveBeenCalled();
  expect(h.thread).toHaveBeenCalledWith("exact", "creator", 1, expect.any(AbortSignal), "either");
  expect(host.textContent).toContain("Storyboards");
});
it("routes a server-authorized reviewer to the exact review screen", async () => {
  h.thread.mockResolvedValue({ ...app, id: "exact", applicantId: "other" });
  await act(async () =>
    root.render(
      <CrewApplications
        userId="creator"
        generation={1}
        onWeb={h.web}
        initialApplicationId="exact"
      />
    )
  );
  expect(host.textContent).toBe("Review:exact");
  expect(h.confirm).not.toHaveBeenCalled();
});
it("keeps denied exact threads out of the list until the user returns", async () => {
  h.thread.mockRejectedValue(new Error("Access denied"));
  await act(async () =>
    root.render(
      <CrewApplications
        userId="creator"
        generation={1}
        onWeb={h.web}
        initialApplicationId="exact"
      />
    )
  );
  expect(host.textContent).toContain("Access denied");
  expect(h.list).not.toHaveBeenCalled();
  await click("nativeApplications.back");
  expect(h.list).toHaveBeenCalledTimes(1);
});

it("switches to received without retaining sent records and opens exact reviewer thread", async () => {
  await render();
  h.list.mockResolvedValue({
    items: [{ ...app, id: "received", applicantId: "other", ownerUserId: "creator" }],
    nextCursor: null,
  });
  h.thread.mockResolvedValue({ ...app, id: "received", applicantId: "other" });
  await click("crewRecruitment.received");
  expect(h.list).toHaveBeenLastCalledWith("creator", null, expect.any(AbortSignal), "received");
  await click("Crew · Director · 2026-09-30 · crewTerms.pending");
  expect(host.textContent).toBe("Review:received");
});
it("aborts the previous scope and ignores its late list response", async () => {
  let resolve!: (value: unknown) => void;
  h.list.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  await render();
  const signal = h.list.mock.calls[0]![2];
  h.list.mockResolvedValue({ items: [], nextCursor: null });
  await click("crewRecruitment.received");
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ items: [app], nextCursor: null }));
  expect(host.textContent).not.toContain("Crew · Director");
});

for (const status of [0, 429, 503]) {
  it(`retains applications and retries the failed cursor after temporary ${status}`, async () => {
    h.list
      .mockResolvedValueOnce({ items: [app], nextCursor: "app" })
      .mockRejectedValueOnce(new ApiRequestError("TEMPORARY", "Please try again", status))
      .mockResolvedValueOnce({
        items: [{ ...app, id: "older", crewName: "Older Crew" }],
        nextCursor: null,
      });
    await render();
    await click("crewTerms.more");
    expect(host.textContent).toContain("Please try again");
    expect(host.textContent).toContain("Director");
    expect(button("crewTerms.more")).toBeUndefined();
    await click("common.retry");
    expect(h.list.mock.calls.map((call) => call[1])).toEqual([null, "app", "app"]);
    expect(host.textContent).toContain("Older Crew");
    expect(host.textContent).not.toContain("Please try again");
  });
}
it("clears applications after access loss and refreshes from page one", async () => {
  h.list
    .mockResolvedValueOnce({ items: [app], nextCursor: "app" })
    .mockRejectedValueOnce(new ApiRequestError("FORBIDDEN", "Access revoked", 403))
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  await render();
  await click("crewTerms.more");
  expect(host.textContent).not.toContain("Director");
  expect(button("common.retry")).toBeUndefined();
  await click("crewTerms.refresh");
  expect(h.list.mock.calls.map((call) => call[1])).toEqual([null, "app", null]);
});

it("returns to the selected application with fresh terms after foregrounding", async () => {
  await open();
  expect(host.textContent).toContain("Storyboards");
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.terms.mockResolvedValue({
    currentVersion: 3,
    items: [{ ...row, version: 3, scope: "Updated terms" }],
    nextBeforeVersion: null,
  });
  h.active = true;
  await render();
  expect(host.textContent).toContain("Updated terms");
  expect(h.list).toHaveBeenCalledTimes(1);
  expect(h.terms).toHaveBeenCalledTimes(2);
});
it("preserves the received applications tab across foreground refresh", async () => {
  await render();
  await click("crewRecruitment.received");
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(h.list).toHaveBeenLastCalledWith("creator", null, expect.any(AbortSignal), "received");
});

it("opens amendments using the refreshed task instead of the inbox snapshot", async () => {
  const taskId = "00000000-0000-4000-8000-000000000003";
  h.thread.mockResolvedValue({ ...app, status: "approved", taskId });
  await open();
  await click("crewAmendments.title");
  expect(button("Amendments").dataset.taskId).toBe(taskId);
});
it("hides amendments when the refreshed thread no longer has a task", async () => {
  h.list.mockResolvedValue({
    items: [{ ...app, taskId: "00000000-0000-4000-8000-000000000002" }],
    nextCursor: null,
  });
  h.thread.mockResolvedValue({ ...app, status: "approved", taskId: null });
  await open();
  expect(button("crewAmendments.title")).toBeUndefined();
});

it("opens the current approved task directly", async () => {
  const taskId = "00000000-0000-4000-8000-000000000003";
  h.thread.mockResolvedValue({ ...app, status: "approved", taskId });
  await open();
  await click("crewFinance.openTask");
  expect(h.push).toHaveBeenCalledWith(`/crew-tasks/crew?task=${taskId}`);
});
it("does not expose a task route before approval", async () => {
  h.thread.mockResolvedValue({ ...app, taskId: "00000000-0000-4000-8000-000000000003" });
  await open();
  expect(button("crewFinance.openTask")).toBeUndefined();
});
