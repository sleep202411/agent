import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TermsProposalScreen } from "./terms-proposal";
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn(), close: vi.fn() }));
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
  taskId: null,
  applicantId: "creator",
  message: "Hello",
  portfolioUrl: null,
  expectedCompensation: null,
  availableStartDate: null,
  yearsExperience: 2,
  status: "pending",
  createdAt: "2026-10-01T00:00:00Z",
  reviewedAt: null,
  reviewerId: null,
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
const click = async (key: string) => {
  await act(async () => button(key).click());
};
const type = async (key: string, value: string) => {
  await act(async () => {
    const input = host.querySelector(`textarea[aria-label="${key}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const render = async () => {
  await act(async () =>
    root.render(
      <TermsProposalScreen
        crewId="crew"
        applicationId="app"
        userId="manager"
        generation={1}
        onClose={h.close}
      />
    )
  );
};
const fill = async () => {
  await type("crewTerms.scope", "Storyboards");
  await type("crewTerms.fee", "123.45");
};
const receipt = (data: object) => ({
  id: "00000000-0000-4000-8000-000000000001",
  applicationId: "app",
  version: 1,
  ...data,
  proposedByUserId: "manager",
  createdAt: app.createdAt,
  confirmedAt: null,
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockImplementation(async (path) =>
    path.endsWith("/positions")
      ? { items: [{ id: "position", crewId: "crew", taskId: null }], nextCursor: null }
      : path.endsWith("/terms")
        ? { currentVersion: 0, items: [], nextBeforeVersion: null }
        : path.endsWith("/interview")
          ? {
              applicationStatus: "pending",
              canUpdate: true,
              canMessage: true,
              version: 0,
              state: "not_started",
              scheduledAt: null,
              items: [],
              nextBeforeVersion: null,
            }
          : app
  );
  h.post.mockImplementation(async (_path, options) => receipt(options.data));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("requires valid terms before sending", async () => {
  await render();
  await click("crewTerms.propose");
  expect(h.post).not.toHaveBeenCalled();
  expect(host.textContent).toContain("crewTerms.invalid");
});
it("proposes exact amounts and the loaded version", async () => {
  await render();
  await fill();
  await type("crewTerms.share", "2.50");
  await type("crewTerms.basis", "Net receipts");
  await click("crewTerms.episode");
  await click("crewTerms.propose");
  expect(h.post).toHaveBeenCalledWith("/applications/app/terms", {
    service: "aurora",
    data: {
      expectedVersion: 0,
      scope: "Storyboards",
      feeAmount: "12345",
      currency: "USD",
      feePeriod: "episode",
      revenueShareBp: 250,
      shareBasis: "Net receipts",
    },
  });
  expect(host.textContent).toContain("termsProposal.saved");
  expect(button("crewTerms.propose")).toBeUndefined();
});
it("retries immutable proposal after response loss", async () => {
  h.post.mockRejectedValueOnce(new Error("Network"));
  await render();
  await fill();
  await click("crewTerms.propose");
  expect(button("crewTerms.discardDraft").disabled).toBe(true);
  expect([...host.querySelectorAll("textarea")].every((i) => i.disabled)).toBe(true);
  await click("termsProposal.retry");
  expect(h.post.mock.calls[1]).toEqual(h.post.mock.calls[0]);
});
it("requires explicit discard and reload after stale version conflict", async () => {
  h.post.mockRejectedValueOnce(Object.assign(new Error("Terms changed"), { status: 409 }));
  await render();
  await fill();
  await click("crewTerms.propose");
  expect(button("crewTerms.propose").disabled).toBe(true);
  expect(button("termsProposal.retry")).toBeUndefined();
  await click("crewTerms.discardDraft");
  expect(button("crewTerms.propose").disabled).toBe(false);
  expect(host.querySelector("textarea")!.value).toBe("");
});
it("locks duplicate taps and navigation during a proposal", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await render();
  await fill();
  await act(async () => {
    button("crewTerms.propose").click();
    button("crewTerms.propose").click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(button("nativeApplications.back").disabled).toBe(true);
  await act(async () => resolve(receipt(h.post.mock.calls[0]![1].data)));
});
it("does not write after switching accounts", async () => {
  await render();
  await fill();
  h.generation = 2;
  await click("crewTerms.propose");
  expect(h.post).not.toHaveBeenCalled();
});
it("ignores late success after leaving", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await render();
  await fill();
  await click("crewTerms.propose");
  await act(async () => root.render(null));
  await act(async () => resolve(receipt(h.post.mock.calls[0]![1].data)));
  expect(host.textContent).toBe("");
});
it("uses project-only bounded fees for task-linked positions", async () => {
  const previous = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, options) =>
    path.endsWith("/positions")
      ? {
          items: [
            { id: "position", crewId: "crew", taskId: "00000000-0000-4000-8000-000000000002" },
          ],
          nextCursor: null,
        }
      : previous(path, options)
  );
  await render();
  expect(button("crewTerms.month").disabled).toBe(true);
  await fill();
  await type("crewTerms.fee", "100000000.01");
  await click("crewTerms.propose");
  expect(h.post).not.toHaveBeenCalled();
  expect(button("termsProposal.retry")).toBeUndefined();
});
it("shows closed applications as read only", async () => {
  const previous = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, options) =>
    path === "/applications/app" ? { ...app, status: "approved" } : previous(path, options)
  );
  await render();
  expect(host.querySelector("textarea")).toBeNull();
});

it("older terms are read only and use the server version cursor", async () => {
  const previous = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path, options) =>
    path.endsWith("/terms")
      ? {
          currentVersion: 2,
          items: [
            {
              ...receipt({
                scope: "Prior work",
                feeAmount: "100",
                currency: "USD",
                feePeriod: "project",
                revenueShareBp: 0,
                shareBasis: null,
              }),
              version: options.params.beforeVersion ? 1 : 2,
            },
          ],
          nextBeforeVersion: options.params.beforeVersion ? null : 2,
        }
      : previous(path, options)
  );
  await render();
  await click("crewTerms.more");
  expect(host.querySelector("textarea")).toBeNull();
  expect(h.get).toHaveBeenCalledWith(
    "/applications/app/terms",
    expect.objectContaining({ params: { limit: 20, beforeVersion: 2 } })
  );
});
