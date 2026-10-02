import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApplicationReview } from "./application-review";
vi.mock("expo-router", () => ({ router: { push: (path: string) => h.push(path) } }));
vi.mock("@/lib/navigation", () => ({ toHref: (path: string) => path }));
vi.mock("./application-amendments", () => ({
  ApplicationAmendments: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Amendments</button>
  ),
}));
vi.mock("./terms-proposal", () => ({
  TermsProposalScreen: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Proposal</button>
  ),
}));
vi.mock("./application-interview", () => ({
  ApplicationInterview: ({
    applicantId,
    onClose,
  }: {
    applicantId: string;
    onClose: () => void;
  }) => <button onClick={onClose}>Interview: {applicantId}</button>,
}));
const h = vi.hoisted(() => ({
  generation: 1,
  push: vi.fn(),
  openUrl: vi.fn(),
  displays: new Map<string, { nickname: string }>(),
  get: vi.fn(),
  post: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white", border: "gray" }) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./user-displays", () => ({ useUserDisplays: () => h.displays }));
vi.mock("react-native", () => ({
  Linking: { openURL: h.openUrl },
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
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <textarea
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
vi.mock("./crew-finance-api", () => ({
  formatFinanceMoney: (amount: string, currency: string) => `${currency} ${amount}`,
}));
const app = {
  id: "app",
  crewId: "crew",
  positionId: "position",
  applicantId: "creator",
  message: "Hello",
  portfolioUrl: null as string | null,
  taskId: null as string | null,
  expectedCompensation: null,
  availableStartDate: null,
  yearsExperience: 2,
  status: "pending",
  createdAt: "2026-10-01T00:00:00Z",
  reviewedAt: null,
  reviewerId: null,
};
const result = {
  ...app,
  status: "approved",
  reviewedAt: "2026-10-01T01:00:00Z",
  reviewerId: "manager",
};
const interview = {
  applicationStatus: "pending",
  canUpdate: true,
  canMessage: true,
  version: 0,
  state: "not_started",
  scheduledAt: null,
  items: [],
  nextBeforeVersion: null,
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
const click = async (key: string) => {
  await act(async () => button(key).click());
};
const render = async () => {
  await act(async () =>
    root.render(
      <ApplicationReview
        crewId="crew"
        userId="manager"
        generation={1}
        onClose={h.close}
        onWeb={h.close}
      />
    )
  );
};
const open = async () => {
  await render();
  await click("creator · position · 2026-10-01");
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.displays.clear();
  app.portfolioUrl = null;
  app.taskId = null;
  h.get.mockImplementation(async (path) =>
    path === "/crews/crew/applications"
      ? { items: [app], nextCursor: null }
      : path.endsWith("/terms")
        ? { currentVersion: 0, items: [], nextBeforeVersion: null }
        : path.endsWith("/interview")
          ? interview
          : app
  );
  h.post.mockResolvedValue(result);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("requires explicit confirmation before approving", async () => {
  await open();
  await click("applicationReview.approve");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("applicationReview.approveHelp");
  await click("applicationReview.confirm");
  expect(h.post).toHaveBeenCalledWith("/applications/app/approve", { service: "aurora" });
  expect(button("applicationReview.approve")).toBeUndefined();
});
it("allows canceling a decision before any write", async () => {
  await open();
  await click("applicationReview.reject");
  await click("report.cancel");
  expect(h.post).not.toHaveBeenCalled();
  expect(button("applicationReview.reject")).toBeTruthy();
});
it("requires refresh after uncertain decision", async () => {
  h.post.mockRejectedValue(new Error("Network"));
  await open();
  await click("applicationReview.approve");
  await click("applicationReview.confirm");
  expect(host.textContent).toContain("applicationReview.recheck");
  expect(button("applicationReview.confirm")).toBeUndefined();
  expect(h.post).toHaveBeenCalledTimes(1);
  await click("crewTerms.refresh");
  expect(button("applicationReview.approve")).toBeTruthy();
});
it("blocks approval with unconfirmed terms but permits rejection", async () => {
  h.get.mockImplementation(async (path) =>
    path === "/crews/crew/applications"
      ? { items: [app], nextCursor: null }
      : path.endsWith("/terms")
        ? {
            currentVersion: 1,
            items: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                applicationId: "app",
                version: 1,
                scope: "Film",
                feeAmount: "100",
                currency: "USD",
                feePeriod: "project",
                revenueShareBp: 0,
                shareBasis: null,
                proposedByUserId: "manager",
                createdAt: app.createdAt,
                confirmedAt: null,
              },
            ],
            nextBeforeVersion: null,
          }
        : path.endsWith("/interview")
          ? interview
          : app
  );
  await open();
  expect(button("applicationReview.approve").disabled).toBe(true);
  expect(button("applicationReview.reject").disabled).toBe(false);
});
it("changes inbox status filters", async () => {
  await render();
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  await click("crewTerms.rejected");
  expect(h.get).toHaveBeenLastCalledWith(
    "/crews/crew/applications",
    expect.objectContaining({ params: { limit: 20, status: "rejected" } })
  );
});
it("locks duplicate confirmation taps", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await open();
  await click("applicationReview.approve");
  await act(async () => {
    button("applicationReview.confirm").click();
    button("applicationReview.confirm").click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(button("nativeApplications.back").disabled).toBe(true);
  await act(async () => resolve(result));
});
it("discards late decisions after leaving", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await open();
  await click("applicationReview.approve");
  await click("applicationReview.confirm");
  await act(async () => root.render(null));
  await act(async () => resolve(result));
  expect(host.textContent).toBe("");
});
it("blocks decisions after account change", async () => {
  await open();
  await click("applicationReview.approve");
  h.generation = 2;
  await click("applicationReview.confirm");
  expect(h.post).not.toHaveBeenCalled();
});

it("opens reviewer interview for the selected applicant and reloads on return", async () => {
  await open();
  await click("reviewerInterview.open");
  expect(host.textContent).toBe("Interview: creator");
  await click("Interview: creator");
  expect(button("applicationReview.approve")).toBeTruthy();
  expect(h.get.mock.calls.filter((c) => c[0] === "/applications/app")).toHaveLength(2);
});

it("opens terms proposals and refreshes approval readiness on return", async () => {
  await open();
  await click("termsProposal.open");
  expect(host.textContent).toBe("Proposal");
  await click("Proposal");
  expect(h.get.mock.calls.filter((c) => c[0] === "/applications/app")).toHaveLength(2);
});

it("opens amendments after approval and reloads the application on return", async () => {
  app.taskId = "00000000-0000-4000-8000-000000000001";
  await open();
  await click("applicationReview.approve");
  await click("applicationReview.confirm");
  await click("crewAmendments.title");
  expect(host.textContent).toBe("Amendments");
  await click("Amendments");
  expect(h.get.mock.calls.filter((c) => c[0] === "/applications/app")).toHaveLength(2);
});

it("opens the applicant public profile from review", async () => {
  await open();
  await click("crewMembers.viewProfile");
  expect(h.push).toHaveBeenCalledWith(`/creator/${encodeURIComponent(app.applicantId)}`);
});

it("opens a valid portfolio and allows retry after an OS failure", async () => {
  app.portfolioUrl = "https://portfolio.example/artist?work=showreel";
  h.openUrl.mockRejectedValueOnce(Error("Browser unavailable")).mockResolvedValueOnce(undefined);
  await open();
  await click("applicationReview.portfolio");
  expect(host.textContent).toContain("Browser unavailable");
  await click("applicationReview.portfolio");
  expect(h.openUrl).toHaveBeenCalledTimes(2);
  expect(h.openUrl).toHaveBeenLastCalledWith(app.portfolioUrl);
  expect(host.textContent).not.toContain("Browser unavailable");
});
it.each([
  "javascript:alert(1)",
  "file:///private/data",
  "https://user:secret@example.com",
  "not a URL",
])("does not launch an invalid portfolio: %s", async (url) => {
  app.portfolioUrl = url;
  await open();
  await click("applicationReview.portfolio");
  expect(h.openUrl).not.toHaveBeenCalled();
  expect(host.textContent).toContain("applicationReview.invalidPortfolio");
});
it("uses the applicant display name without changing the profile destination", async () => {
  h.displays.set("creator", { nickname: "River Chen" });
  await render();
  await click("River Chen · position · 2026-10-01");
  expect(host.textContent).toContain("River Chen");
  await click("crewMembers.viewProfile");
  expect(h.push).toHaveBeenCalledWith("/creator/creator");
});

it("opens an approved task directly from the owner review", async () => {
  app.taskId = "00000000-0000-4000-8000-000000000001";
  await open();
  expect(button("crewFinance.openTask")).toBeUndefined();
  await click("applicationReview.approve");
  await click("applicationReview.confirm");
  await click("crewFinance.openTask");
  expect(h.push).toHaveBeenCalledWith(`/crew-tasks/crew?task=${app.taskId}`);
});
it("omits task-only actions for an approved Crew membership without a task", async () => {
  await open();
  await click("applicationReview.approve");
  await click("applicationReview.confirm");
  expect(button("crewFinance.openTask")).toBeUndefined();
  expect(button("crewAmendments.title")).toBeUndefined();
});
