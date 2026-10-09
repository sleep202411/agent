import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewApplications } from "./crew-applications";
vi.mock("./application-amendments", () => ({
  ApplicationAmendments: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Amendments</button>
  ),
}));
vi.mock("./application-interview", () => ({ ApplicationInterview: () => <span>Interview</span> }));
vi.mock("./position-invitations", () => ({ PositionInvitations: () => <span>Invitations</span> }));
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  list: vi.fn(),
  terms: vi.fn(),
  confirm: vi.fn(),
  web: vi.fn(),
}));
vi.mock("./application-terms-api", () => ({
  fetchMyApplications: h.list,
  fetchApplicationTerms: h.terms,
  confirmApplicationTerms: h.confirm,
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
  expect(host.textContent).toContain("crewTerms.noPayment");
  expect(h.confirm).not.toHaveBeenCalled();
  await click("crewTerms.confirm");
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
    button("crewTerms.confirm").click();
    button("crewTerms.confirm").click();
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
  await click("crewTerms.confirm");
  expect(host.textContent).toContain("Network");
  await click("nativeApplications.retry");
  expect(h.confirm.mock.calls[0]).toEqual(h.confirm.mock.calls[1]);
  expect(host.textContent).not.toContain("Network");
});
it("requires refresh after a version conflict", async () => {
  h.confirm.mockRejectedValue(Object.assign(new Error("Terms changed"), { status: 409 }));
  await open();
  await click("crewTerms.confirm");
  expect(button("nativeApplications.retry").disabled).toBe(true);
  h.terms.mockResolvedValue({
    currentVersion: 3,
    items: [{ ...row, version: 3, scope: "Revised scope" }],
    nextBeforeVersion: null,
  });
  await click("crewTerms.refresh");
  expect(host.textContent).toContain("Revised scope");
  expect(h.confirm).toHaveBeenCalledTimes(1);
  expect(button("crewTerms.confirm").disabled).toBe(false);
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
  expect(button("crewTerms.confirm")).toBeUndefined();
});
it.each(["approved", "rejected"])("does not confirm a %s application", async (status) => {
  h.list.mockResolvedValue({ items: [{ ...app, status }], nextCursor: null });
  await render();
  await click(`Crew · Director · 2026-09-30 · crewTerms.${status}`);
  expect(button("crewTerms.confirm")).toBeUndefined();
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
