import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import MyApplicationsPage from "./page";
const h = vi.hoisted(() => ({ user: "alice", get: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.user ? { id: h.user } : null, isLoading: false }),
}));
vi.mock("../_hooks/api", () => ({ crewApi: { get: (...a: unknown[]) => h.get(...a) } }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../_components/crew-section-navigation", () => ({ CrewSectionNavigation: () => null }));
vi.mock("../_components/application-terms-panel", () => ({
  ApplicationTermsPanel: ({ applicationId }: { applicationId: string }) => (
    <div>Terms for {applicationId}</div>
  ),
}));
let root: Root, host: HTMLDivElement, qc: QueryClient;
const row = (id: string) => ({
  id,
  applicantId: "alice",
  crewName: "Crew",
  crewId: "crew",
  ownerUserId: "owner",
  positionType: "Writer",
  status: "pending",
  createdAt: "2026-09-25",
  taskId: "task",
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.user = "alice";
  h.get.mockReset().mockResolvedValue({ items: [row("first")], nextCursor: "first" });
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
        <MyApplicationsPage />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
it("opens private terms from applicant-owned history and loads the next bounded page", async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>("li button")!.click());
  expect(host.textContent).toContain("Terms for first");
  h.get.mockResolvedValue({ items: [row("second")], nextCursor: null });
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "more")!
      .click()
  );
  expect(h.get).toHaveBeenLastCalledWith(
    "/me/crew-applications",
    expect.objectContaining({ query: { limit: 20, cursor: "first", scope: "sent" } })
  );
});
it("clears selected private terms and history on account switch", async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>("li button")!.click());
  h.user = "bob";
  h.get.mockResolvedValue({ items: [], nextCursor: null });
  await render();
  expect(host.textContent).not.toContain("Terms for first");
  expect(host.textContent).toContain("empty");
});
it("does not request applicant history when signed out", async () => {
  h.user = "";
  await render();
  expect(h.get).not.toHaveBeenCalled();
  expect(host.textContent).toContain("signIn");
});

vi.mock("../_components/application-interview-panel", () => ({
  ApplicationInterviewPanel: () => <div>Interview controls</div>,
}));

vi.mock("../_components/position-invitations-panel", () => ({
  PositionInvitationsPanel: () => null,
}));

vi.mock("../_components/application-amendments-panel", () => ({
  ApplicationAmendmentsPanel: () => null,
}));

vi.mock("../_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (id: string) => id,
}));
vi.mock("../_components/application-review-dialog", () => ({
  ApplicationReviewDialog: () => <div>Review application</div>,
}));
it("switches to owner inbox without retaining the selected applicant conversation", async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>("li button")!.click());
  expect(host.textContent).toContain("Terms for first");
  h.get.mockResolvedValue({
    items: [{ ...row("received"), applicantId: "creator" }],
    nextCursor: null,
  });
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "received")!
      .click()
  );
  await render();
  expect(host.textContent).not.toContain("Terms for first");
  expect(h.get).toHaveBeenLastCalledWith(
    "/me/crew-applications",
    expect.objectContaining({ query: { limit: 20, cursor: undefined, scope: "received" } })
  );
  await act(async () => host.querySelector<HTMLButtonElement>("li button")!.click());
  expect(host.textContent).toContain("Terms for received");
  expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "review")).toBe(
    true
  );
});
