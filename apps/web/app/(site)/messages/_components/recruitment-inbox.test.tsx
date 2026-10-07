import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { RecruitmentInbox } from "./recruitment-inbox";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "me" } }) }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: vi.fn() }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../../crews/_hooks/api", () => ({ crewApi: h }));
vi.mock("../../crews/_hooks/use-position-label", () => ({
  useTranslatePositionValue: () => (value: string) => value,
}));
vi.mock("../../crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (id: string) => id,
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("./recruitment-creator-summary", () => ({ RecruitmentCreatorSummary: () => null }));
vi.mock("../../crews/_components/position-invitations-panel", () => ({
  PositionInvitationsPanel: () => null,
}));
vi.mock("../../crews/_components/application-interview-panel", () => ({
  ApplicationInterviewPanel: () => null,
}));
vi.mock("../../crews/_components/application-amendments-panel", () => ({
  ApplicationAmendmentsPanel: () => null,
}));
vi.mock("../../crews/_components/application-terms-panel", () => ({
  ApplicationTermsPanel: () => null,
}));
vi.mock("../../crews/_components/application-review-dialog", () => ({
  ApplicationReviewDialog: () => null,
}));
let root: Root, host: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  host?.remove();
  vi.clearAllMocks();
});
async function render() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <RecruitmentInbox />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
it("combines both directions with ownership badges and independent pagination", async () => {
  h.get.mockImplementation((_path, { query }) =>
    Promise.resolve({
      items: [
        {
          id: query.scope,
          applicantId: query.scope === "sent" ? "me" : "applicant",
          ownerUserId: "owner",
          crewId: "crew",
          crewName: "Crew",
          taskTitle: query.scope,
          status: "pending",
          createdAt: "2026-10-07T00:00:00Z",
        },
      ],
      nextCursor: query.cursor ? null : query.scope,
    })
  );
  await render();
  expect(host.textContent).toContain("myApplicationBadge");
  expect(host.textContent).toContain("myTaskBadge");
  expect(host.querySelectorAll("li")).toHaveLength(2);
  const more = [...host.querySelectorAll("button")].find((x) => x.textContent === "more")!;
  await act(async () => more.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(h.get).toHaveBeenCalledWith(
    "/me/crew-applications",
    expect.objectContaining({ query: expect.objectContaining({ scope: "sent", cursor: "sent" }) })
  );
  expect(h.get).toHaveBeenCalledWith(
    "/me/crew-applications",
    expect.objectContaining({
      query: expect.objectContaining({ scope: "received", cursor: "received" }),
    })
  );
  expect(host.querySelectorAll("li")).toHaveLength(2);
});
it("keeps a failed direction visible as an error rather than claiming an empty inbox", async () => {
  h.get.mockImplementation((_path, { query }) =>
    query.scope === "received"
      ? Promise.reject(new Error("Inbox unavailable"))
      : Promise.resolve({ items: [], nextCursor: null })
  );
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Inbox unavailable");
  expect(host.querySelectorAll("li")).toHaveLength(0);
});
