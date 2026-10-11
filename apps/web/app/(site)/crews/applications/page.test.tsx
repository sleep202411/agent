import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { RecruitmentInbox as MyApplicationsPage } from "../../messages/_components/recruitment-inbox";
vi.mock("@/src/lib/api", () => ({
  api: { post: async () => ({ info: {}, level: [] }), postForm: async () => [] },
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
const h = vi.hoisted(() => ({ user: "alice", get: vi.fn(), login: vi.fn() }));
vi.mock("@/components/auth/auth-dialog-provider", () => ({
  useAuthDialog: () => ({ open: h.login }),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.user ? { id: h.user } : null, isLoading: false }),
}));
vi.mock("../_hooks/api", () => ({
  crewApi: {
    get: (...a: unknown[]) =>
      typeof a[0] === "string" && a[0].startsWith("/applications/")
        ? h
            .get(...a)
            .then((result: { items: ReturnType<typeof row>[] }) =>
              result.items?.find((item) => item.id === (a[0] as string).split("/").pop())
            )
        : h.get(...a),
  },
}));
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
  h.login.mockReset();
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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(host.textContent).toContain("Terms for first");
  h.get.mockResolvedValue({ items: [row("second")], nextCursor: null });
  await act(async () =>
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "more")!
      .click()
  );
  for (const scope of ["sent", "received"]) {
    expect(h.get).toHaveBeenCalledWith(
      "/me/crew-applications",
      expect.objectContaining({ query: { limit: 20, cursor: "first", scope } })
    );
  }
});
it("clears selected private terms and history on account switch", async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>("li button")!.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
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
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(h.login).toHaveBeenCalledOnce();
});

vi.mock("../_components/application-interview-panel", () => ({
  ApplicationInterviewPanel: ({ offer }: { offer: React.ReactNode }) => (
    <div>Interview controls{offer}</div>
  ),
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
it("switches between sent and received conversations in the combined inbox", async () => {
  const received = { ...row("received"), applicantId: "creator", taskTitle: "Owner task" };
  h.get.mockImplementation((path: string, options?: { query?: { scope?: string } }) => {
    const items = path.startsWith("/applications/")
      ? [row("first"), received]
      : options?.query?.scope === "received"
        ? [received]
        : [row("first")];
    return Promise.resolve({ items, nextCursor: null });
  });
  await render();
  expect(host.querySelectorAll("li button")).toHaveLength(2);
  await act(async () => host.querySelector<HTMLButtonElement>("li button")!.click());
  await render();
  expect(host.textContent).toContain("Terms for first");
  expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "review")).toBe(
    false
  );
  await act(async () =>
    Array.from(host.querySelectorAll<HTMLButtonElement>("li button"))
      .find((b) => b.textContent?.includes("Owner task"))!
      .click()
  );
  await render();
  expect(host.textContent).not.toContain("Terms for first");
  expect(host.textContent).toContain("Terms for received");
  expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "review")).toBe(
    true
  );
});

it("hides selected private panels after a failed inbox refresh and restores access on retry", async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>("li button")!.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(host.textContent).toContain("Terms for first");
  h.get.mockRejectedValue(new Error("Application access revoked"));
  await act(async () => {
    await qc.refetchQueries();
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(host.textContent).not.toContain("Terms for first");
  expect(host.textContent).not.toContain("Interview controls");
  expect(host.querySelector("section [role=alert]")?.textContent).toContain(
    "Application access revoked"
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Application access revoked");
  expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "more")).toBe(
    false
  );
  h.get.mockResolvedValue({ items: [row("first")], nextCursor: null });
  await act(async () => {
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === "refresh")!
      .click();
    await qc.refetchQueries();
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(host.textContent).toContain("Terms for first");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("lets a selected conversation recover or return to the inbox while its detail read fails", async () => {
  await render();
  h.get.mockImplementation((path: string) =>
    path.startsWith("/applications/")
      ? Promise.reject(new Error("Conversation unavailable"))
      : Promise.resolve({ items: [row("first")], nextCursor: null })
  );
  await act(async () => host.querySelector<HTMLButtonElement>("li button")!.click());
  await render();
  const panel = host.querySelector("section")!;
  expect(panel.textContent).toContain("Conversation unavailable");
  expect(panel.textContent).not.toContain("Interview controls");
  await act(async () =>
    Array.from(panel.querySelectorAll("button"))
      .find((b) => b.textContent === "back")!
      .click()
  );
  expect(host.querySelector("section [role=alert]")).toBeNull();
  expect(host.querySelector("li button")?.getAttribute("aria-pressed")).toBe("false");
  await act(async () => host.querySelector<HTMLButtonElement>("li button")!.click());
  await render();
  h.get.mockResolvedValue({ items: [row("first")], nextCursor: null });
  await act(async () =>
    Array.from(panel.querySelectorAll("button"))
      .find((b) => b.textContent === "refresh")!
      .click()
  );
  await render();
  expect(panel.textContent).toContain("Terms for first");
  expect(panel.querySelector("[role=alert]")).toBeNull();
});
